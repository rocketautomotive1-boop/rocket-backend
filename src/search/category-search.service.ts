import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { CategoryDocument } from '../product/schemas/category.schema';

@Injectable()
export class CategorySearchService implements OnModuleInit {
    private readonly logger = new Logger(CategorySearchService.name);
    private readonly index = 'categories-xxbl';

    constructor(private readonly elasticsearchService: ElasticsearchService) { }

    async onModuleInit() {
        await this.createIndex();
    }

    async createIndex() {
        try {
            const indexExists = await this.elasticsearchService.indices.exists({ index: this.index });

            if (!indexExists) {
                await this.elasticsearchService.indices.create({
                    index: this.index,
                    settings: {
                        analysis: {
                            analyzer: {
                                autocomplete_analyzer: {
                                    type: "custom",
                                    tokenizer: "autocomplete",
                                    filter: ["lowercase"]
                                },
                                autocomplete_search_analyzer: {
                                    type: "custom",
                                    tokenizer: "lowercase",
                                    filter: []
                                }
                            },
                            tokenizer: {
                                autocomplete: {
                                    type: "edge_ngram",
                                    min_gram: 2,
                                    max_gram: 10,
                                    token_chars: ["letter", "digit"]
                                }
                            }
                        }
                    },
                    mappings: {
                        properties: {
                            id: { type: 'keyword' },
                            name: {
                                type: 'text',
                                analyzer: 'autocomplete_analyzer',
                                search_analyzer: 'autocomplete_search_analyzer',
                                fields: {
                                    keyword: { type: 'keyword' }
                                }
                            },
                            examples: {
                                type: 'text',
                                analyzer: 'autocomplete_analyzer',
                                search_analyzer: 'autocomplete_search_analyzer'
                            },
                            synonyms: {
                                type: 'text',
                                analyzer: 'autocomplete_analyzer',
                                search_analyzer: 'autocomplete_search_analyzer'
                            },
                            usageGuide: { type: 'text' },
                            breadcrumbs: { type: 'text' }, // New field
                            slug: { type: 'keyword' },
                            parentId: { type: 'keyword' },
                            ancestors: { type: 'keyword' },
                            active: { type: 'boolean' },
                            order: { type: 'integer' },
                            count: { type: 'integer' }, // To store product count if needed
                            image: { type: 'keyword' },
                            relevance: { type: 'integer' }
                        }
                    }
                });
                this.logger.log(`Created index: ${this.index}`);
            }
        } catch (error) {
            this.logger.error(`Error creating index ${this.index}: ${error.message}`, error.stack);
        }
    }

    async indexCategory(category: CategoryDocument, breadcrumbsText?: string) {
        try {
            const body = {
                id: category._id.toString(),
                name: category.name,
                slug: category.slug,
                parentId: category.parentId ? category.parentId.toString() : null,
                ancestors: category.ancestors ? category.ancestors.map(id => id.toString()) : [],
                breadcrumbs: breadcrumbsText || '', // New field
                active: category.active,
                // order: category.order || 0, // Assuming order might be added later or exists
                image: category.image,
                relevance: category.relevance || 0,
                // New AI fields
                examples: category.examples || [],
                synonyms: category.synonyms || [],
                usageGuide: category.usageGuide || ''
            };

            await this.elasticsearchService.index({
                index: this.index,
                id: category.id || category._id.toString(),
                document: body,
            });
            this.logger.log(`Indexed category: ${category.name}`);
        } catch (error) {
            this.logger.error(`Error indexing category ${category._id}: ${error.message}`);
        }
    }

    async removeCategory(id: string) {
        try {
            await this.elasticsearchService.delete({
                index: this.index,
                id: id
            });
            this.logger.log(`Removed category from index: ${id}`);
        } catch (error) {
            // Ignore not found errors as the goal is achieved (it's gone)
            if (error.meta?.body?.result === 'not_found' || error.message.includes('not_found')) {
                this.logger.debug(`Category ${id} not found in index, skip remove.`);
                return;
            }
            this.logger.error(`Error removing category ${id}: ${error.message}`);
        }
    }

    async getTree() {
        try {
            // Fetch all categories (assuming not millions)
            const result = await this.elasticsearchService.search({
                index: this.index,
                size: 1000,
                body: {
                    query: {
                        match_all: {}

                        // Optional: Filter only active
                        // term: { active: true }
                    },
                    sort: [
                        { "name.keyword": "asc" }
                    ]
                } as any
            });

            const hits = result.hits.hits.map(hit => hit._source as any);
            return this.buildTree(hits);
        } catch (error) {
            this.logger.error(`Error fetching category tree: ${error.message}`);
            return [];
        }
    }

    private buildTree(categories: any[]) {
        const map = new Map();
        const roots: any[] = [];

        // Initialize map
        categories.forEach(cat => {
            map.set(cat.id, { ...cat, children: [] });
        });

        // Build hierarchy
        categories.forEach(cat => {
            if (cat.parentId && map.has(cat.parentId)) {
                map.get(cat.parentId).children.push(map.get(cat.id));
            } else {
                roots.push(map.get(cat.id));
            }
        });

        return roots;
    }

    async searchCategories(query: string) {
        try {
            const result = await this.elasticsearchService.search({
                index: this.index,
                body: {
                    query: {
                        function_score: {
                            query: {
                                multi_match: {
                                    query: query,
                                    fields: ["name^3", "synonyms^2", "examples"],
                                    fuzziness: "AUTO"
                                }
                            },
                            field_value_factor: {
                                field: "relevance",
                                factor: 1.2, // Multiplier
                                modifier: "log1p", // smooths out large values: log(1 + relevance)
                                missing: 0
                            },
                            boost_mode: "sum" // Add to the score
                        }
                    }
                } as any
            });
            return result.hits.hits.map(hit => hit._source);
        } catch (error) {
            this.logger.error(`Error searching categories: ${error.message}`);
            return [];
        }
    }
}
