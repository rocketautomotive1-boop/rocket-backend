import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CategoryModel } from '../product/schemas/category.schema';
// import { CategoryMappingModel } from '../marketplace/schemas/category-mapping.schema';

@Injectable()
export class CategoryDiscoveryService implements OnModuleInit {
    private readonly logger = new Logger(CategoryDiscoveryService.name);
    private readonly index = 'categories-discovery-v7'; // Bump to v7 for aiReason and attributes fields

    constructor(
        private readonly elasticsearchService: ElasticsearchService,
        @InjectModel(CategoryModel.name) private categoryModel: Model<CategoryModel>
    ) { }

    async onModuleInit() {
        await this.createIndex();
        // Optional: Auto-sync on startup or leave for manual trigger
        // await this.indexAllCategories();
    }

    async createIndex() {
        try {
            const indexExists = await this.elasticsearchService.indices.exists({ index: this.index });
            if (!indexExists) {
                const indexBody: any = {
                    index: this.index,
                    body: {
                        mappings: {
                            properties: {
                                name: {
                                    type: 'text',
                                    analyzer: 'category_analyzer',
                                    fields: {
                                        keyword: { type: 'keyword' },
                                        exact: {
                                            type: 'keyword',
                                            normalizer: 'exact_normalizer'
                                        }
                                    }
                                },
                                breadcrumbs: { type: 'text', analyzer: 'category_analyzer' },
                                synonyms: { type: 'text', analyzer: 'category_analyzer' },
                                examples: { type: 'text', analyzer: 'category_analyzer' },
                                usageGuide: { type: 'text', analyzer: 'standard' },
                                aiReason: { type: 'text', analyzer: 'standard' },
                                attributes: { type: 'keyword' },
                                slug: { type: 'keyword' },
                                id: { type: 'keyword' },
                                productCount: { type: 'integer' },
                                hasChildren: { type: 'boolean' },
                                mappings: {
                                    type: 'nested',
                                    properties: {
                                        marketplace: { type: 'keyword' },
                                        externalId: { type: 'keyword' }
                                    }
                                }
                            }
                        },
                        settings: {
                            analysis: {
                                analyzer: {
                                    category_analyzer: {
                                        type: "custom",
                                        tokenizer: "standard",
                                        filter: ["lowercase", "asciifolding", "portuguese_stemmer"]
                                    }
                                },
                                filter: {
                                    portuguese_stemmer: {
                                        type: "stemmer",
                                        language: "portuguese"
                                    }
                                },
                                normalizer: {
                                    exact_normalizer: {
                                        type: "custom",
                                        filter: ["lowercase", "asciifolding"]
                                    }
                                }
                            }
                        }
                    }
                };
                await this.elasticsearchService.indices.create(indexBody);
                this.logger.log(`Created index: ${this.index}`);
            } else {
                // Update mapping if possible, but normalizers usually require close/open or reindex.
                // Since we bumped version to v3, this block executes for v3 check (false) -> createIndex above.
                // For existing v3 (if any), we try to verify mapping
                try {
                    // Just in case we are in a dev loop
                    // Putting mapping to existing index fails if we try to change analyzer/normalizer of existing field
                } catch (e) { }
            }
        } catch (error) {
            this.logger.error(`Error creating index ${this.index}: ${error.message}`);
        }
    }

    async recreateIndex() {
        try {
            const exists = await this.elasticsearchService.indices.exists({ index: this.index });
            if (exists) {
                await this.elasticsearchService.indices.delete({ index: this.index });
                this.logger.log(`Deleted index: ${this.index}`);
            }
            await this.createIndex();
            return { message: 'Index recreated' };
        } catch (error) {
            this.logger.error(`Error recreating index: ${error.message}`);
            throw error;
        }
    }

    async indexAllCategories() {
        try {
            this.logger.log('Starting category indexing...');
            const categories = await this.categoryModel.find({ active: true, hidden: { $ne: true } }).populate('ancestors').exec();

            // Build a set of parent IDs to determine which categories have children
            const parentIds = new Set<string>();
            categories.forEach(cat => {
                if (cat.parentId) {
                    parentIds.add(cat.parentId.toString());
                }
            });

            const operations = categories.flatMap(doc => {
                // ... (existing logging logic for Grampos e Fixadores if needed, can skip for brevity or keep) ...
                // Reusing helper logic would be better but let's just duplicate slightly for safety or extract helper
                return this.buildIndexOperation(doc, parentIds.has(doc._id.toString()));
            });

            if (operations.length > 0) {
                const { errors, items } = await this.elasticsearchService.bulk({ operations });
                if (errors) {
                    this.logger.error('Errors occurred during bulk indexing', items);
                } else {
                    this.logger.log(`Indexed ${categories.length} categories successfully.`);
                }
            }
        } catch (error) {
            this.logger.error(`Error indexing categories: ${error.message}`);
            throw error;
        }
    }

    private buildIndexOperation(doc: any, hasChildren: boolean) {
        const ancestors = (doc.ancestors as any[]) || [];
        const breadcrumbs = [...ancestors.map(a => a.name), doc.name].join(' > ');
        const docId = doc._id.toString();

        const msMappings = (doc.marketplaceMappings || []).map(m => ({
            marketplace: String(m.marketplaceId),
            externalId: m.externalId
        }));

        return [
            { index: { _index: this.index, _id: docId } },
            {
                name: doc.name,
                breadcrumbs: breadcrumbs,
                slug: doc.slug,
                id: docId,
                hasChildren: hasChildren,
                synonyms: doc.synonyms || [],
                examples: doc.examples || [],
                usageGuide: doc.usageGuide || '',
                attributes: doc.attributes || [],
                mappings: msMappings,
                productCount: doc.productCount || 0,
                aiReason: doc.aiReason // Ensure this field is mapped
            }
        ];
    }

    async indexCategory(category: any) {
        try {
            // Check for children (expensive? maybe just assume false or query?)
            // For a single update, we might not know if it has children without checking.
            // Let's do a quick check.
            const hasChildrenCount = await this.categoryModel.countDocuments({ parentId: category._id });

            // Need to populate ancestors if not populated
            let doc = category;
            if (!doc.ancestors || (doc.ancestors.length > 0 && !doc.ancestors[0].name)) {
                doc = await this.categoryModel.findById(category._id).populate('ancestors').exec();
            }

            const operations = this.buildIndexOperation(doc, hasChildrenCount > 0);

            // operations is [meta, body]
            await this.elasticsearchService.index({
                index: this.index,
                id: operations[0].index._id,
                document: operations[1]
            });

            this.logger.log(`Indexed single category: ${doc.name} (Count: ${doc.productCount})`);
        } catch (error) {
            this.logger.error(`Error indexing category ${category._id}: ${error.message}`);
        }
    }

    async discover(query: string): Promise<any> {
        try {
            const cleanQuery = query.trim();
            const words = cleanQuery.split(' ').filter(w => w.length > 0);
            const shouldClauses: any[] = [];

            // 0. EXACT MATCH BOOST (The "Killer" Feature - v4 Reinforced)
            // Use MATCH on exact field to ensure normalizer is applied to query
            shouldClauses.push({
                match: {
                    "name.exact": {
                        query: cleanQuery,
                        boost: 500.0 // Super Massive boost
                    }
                }
            });

            // Backup: Case-sensitive strict match (if normalizer fails for some reason)
            shouldClauses.push({
                term: {
                    "name.keyword": {
                        value: cleanQuery,
                        boost: 500.0
                    }
                }
            });

            // 1. Full Phrase Context (Baseline)
            shouldClauses.push({
                match_phrase: {
                    name: {
                        query: cleanQuery,
                        boost: 10.0
                    }
                }
            });

            // 1.1 Synonyms Match (High Value)
            shouldClauses.push({
                match_phrase: {
                    synonyms: {
                        query: cleanQuery,
                        boost: 30.0
                    }
                }
            });

            // Also boost exact synonym match
            shouldClauses.push({
                match: {
                    "synonyms": {
                        query: cleanQuery,
                        operator: "and", // Prevent partial matches from hijacking score
                        boost: 200.0
                    }
                }
            });


            // 2. Head Bigram Boost
            if (words.length >= 2) {
                shouldClauses.push({
                    match_phrase: {
                        name: {
                            query: `${words[0]} ${words[1]}`,
                            slop: 2,
                            boost: 25.0
                        }
                    }
                });

                shouldClauses.push({
                    match: {
                        name: {
                            query: `${words[0]} ${words[1]}`,
                            operator: 'and',
                            boost: 20.0,
                            fuzziness: '2'
                        }
                    }
                });

                // Check Synonyms for bigrams too
                shouldClauses.push({
                    match: {
                        synonyms: {
                            query: `${words[0]} ${words[1]}`,
                            operator: 'and',
                            boost: 15.0,
                            fuzziness: '1'
                        }
                    }
                });
            }

            // 3. Examples & Usage Guide (Semantic/Contextual Match)
            shouldClauses.push({
                match: {
                    examples: {
                        query: cleanQuery,
                        boost: 20.0,
                        operator: "or"
                    }
                }
            });

            shouldClauses.push({
                match: {
                    usageGuide: {
                        query: cleanQuery,
                        boost: 2.0
                    }
                }
            });

            // 4. Breadcrumbs Context
            shouldClauses.push({
                match: {
                    breadcrumbs: {
                        query: cleanQuery,
                        boost: 1.0
                    }
                }
            });

            // 5. Decaying Boost for Individual Terms - CONSTANT SCORE
            // Using constant_score to ignore IDF (rarity) and strictly enforce our positional logic
            words.forEach((word, index) => {
                if (index === 0) {
                    shouldClauses.push({
                        constant_score: {
                            filter: {
                                match: {
                                    name: {
                                        query: word,
                                        fuzziness: 'AUTO'
                                    }
                                }
                            },
                            boost: 30.0 // Reduced from 50.0
                        }
                    });
                } else if (index === 1) {
                    shouldClauses.push({
                        constant_score: {
                            filter: {
                                match: {
                                    name: {
                                        query: word,
                                        fuzziness: 'AUTO'
                                    }
                                }
                            },
                            boost: 5.0 // Reduced from 10.0
                        }
                    });
                } else {
                    shouldClauses.push({
                        constant_score: {
                            filter: {
                                match: {
                                    name: {
                                        query: word,
                                        fuzziness: 'AUTO'
                                    }
                                }
                            },
                            boost: 1.0 // Reduced from 2.5
                        }
                    });
                }

                // Decaying Synonym Boost - CONSTANT SCORE
                // Reconciles "Bucha Inferior..." (needs deep match) vs "Coxim Inferior..." (needs head match)
                // Index 0 (Subject) gets highest priority.
                let synBoost = 50.0; // Increased context boost from 20.0 to 50.0 (e.g. for "Radiador")
                if (index === 0) synBoost = 150.0; // Massive fixed score for Head Noun
                else if (index === 1) synBoost = 40.0;

                shouldClauses.push({
                    constant_score: {
                        filter: {
                            match: {
                                synonyms: {
                                    query: word,
                                    operator: "and",
                                    fuzziness: 'AUTO'
                                }
                            }
                        },
                        boost: synBoost
                    }
                });
            });

            const result = await this.elasticsearchService.search({
                index: this.index,
                body: {
                    size: 5,
                    query: {
                        bool: {
                            should: shouldClauses,
                            minimum_should_match: 1,
                            filter: [
                                {
                                    term: {
                                        hasChildren: false
                                    }
                                }
                            ]
                        }
                    }
                } as any
            });

            const hits = result.hits.hits;
            return hits.map(hit => {
                const source = hit._source as any;
                return {
                    id: source.id,
                    name: source.name,
                    breadcrumbs: source.breadcrumbs,
                    score: hit._score,
                    mappings: source.mappings || [],
                    synonyms: source.synonyms,
                    examples: source.examples,
                    usage: source.usageGuide, // Map usageGuide to usage
                    aiReason: source.aiReason,
                    attributes: source.attributes,
                    productCount: source.productCount || 0
                };
            });
        } catch (error) {
            this.logger.error(`Error discovering category for "${query}": ${error.message}`);
            return [];
        }
    }
}
