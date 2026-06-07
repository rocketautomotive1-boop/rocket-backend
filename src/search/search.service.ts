import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { ProductDocument, ProductModel } from '../product/schemas/product.schema';
import { ProductService } from '../product/product.service'; // Added import
import { ProductRepository } from '../product/product.repository';
import { ProductCompatibilityService } from '../product/services/product-compatibility.service';
import { CrossReferenceService } from '../product/services/cross-reference.service';
import { ListingService } from '../listing/listing.service'; // [NEW] Import
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';

@Injectable()
export class SearchService implements OnModuleInit {
    private readonly logger = new Logger(SearchService.name);
    private readonly index = 'search-xxbl';

    constructor(
        private readonly elasticsearchService: ElasticsearchService,
        @Inject(forwardRef(() => ProductCompatibilityService))
        private readonly productCompatibilityService: ProductCompatibilityService,
        @Inject(forwardRef(() => CrossReferenceService))
        private readonly crossReferenceService: CrossReferenceService,
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
        private readonly listingService: ListingService,
        private readonly productRepository: ProductRepository,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    ) { }

    async onModuleInit() {
        await this.createIndex();
    }

    async createIndex() {
        try {
            const indexExists = await this.elasticsearchService.indices.exists({ index: this.index });

            // Define Synonym List
            const automotiveSynonyms = [
                "bieleta, tirante da barra estabilizadora, bieleta da suspensao",
                "amortecedor, suspensao",
                "bucha, coxim",
                "disco de freio, rotor",
                "pastilha, lona",
                "junta homocinetica, bolachao, trizeta",
                "alternador, gerador",
                "arranque, motor de partida",
                "velas, ignicao",
                "filtro de oleo, refil",
                "bomba dagua, water pump",
                "radiador, arrefecimento",
                "carter, fundo do motor"
            ];

            if (!indexExists) {
                await this.elasticsearchService.indices.create({
                    index: this.index,
                    settings: {
                        analysis: {
                            filter: {
                                automotive_synonym_filter: {
                                    type: "synonym_graph",
                                    synonyms: automotiveSynonyms
                                }
                            },
                            analyzer: {
                                automotive_synonym_analyzer: {
                                    type: "custom",
                                    tokenizer: "standard",
                                    filter: ["lowercase", "automotive_synonym_filter"]
                                }
                            }
                        }
                    },
                    mappings: {
                        properties: {
                            partNumber: {
                                type: 'keyword',
                                fields: {
                                    text: { type: 'text', analyzer: 'standard' }
                                }
                            },
                            all_titles: {
                                type: 'text',
                                analyzer: 'standard', // Index usage
                                search_analyzer: 'automotive_synonym_analyzer' // Query usage (Graph requires search_analyzer usually) 
                            },
                            compatibilities_text: { type: 'text', analyzer: 'standard' },
                            brand: {
                                type: 'text',
                                fields: {
                                    keyword: { type: 'keyword', ignore_above: 256 }
                                }
                            },
                            brandId: { type: 'keyword' }, // NEW: Direct Brand ID for robust selection
                            marketplace: { type: 'keyword' },
                            externalId: { type: 'keyword' },
                            price: { type: 'float' },
                            listPrice: { type: 'float' }, // NEW
                            totalSold: { type: 'integer' },
                            ratingAverage: { type: 'float' }, // NEW
                            ratingCount: { type: 'integer' }, // NEW
                            thumbnail: { type: 'keyword' }, // NEW
                            brandImage: { type: 'keyword' }, // NEW
                            quantity: { type: 'integer' }, // NEW
                            crossReferenceCodes: { type: 'keyword' },
                            crossReferenceBrands: { type: 'keyword' },
                            cross_references_text: { type: 'text', analyzer: 'standard' },
                            all_codes_clean: { type: 'keyword' },
                            categories: {
                                type: 'text',
                                fields: {
                                    keyword: { type: 'keyword', ignore_above: 256 }
                                }
                            }, // NEW: Categories for faceting
                            categoryIds: { type: 'keyword' }, // NEW: Category IDs for robust filtering
                            description: { type: 'text', analyzer: 'standard' } // NEW
                        }
                    }
                });
                this.logger.log(`Created index with Synonyms: ${this.index}`);
            } else {
                // For this specific update (Settings change), we usually need to close/open or re-create.
                // We will log a warning that settings might not be updated unless re-created.
                // We attempt to put mapping, but standard flow requires index deletion for Analyzer changes.
                this.logger.warn(`Index ${this.index} exists. If you want to apply new Synonym Analyzers, you must DELETE the index first.`);

                // Still try to update mappings just in case of field additions
                try {
                    // ... (Mapping update logic remains similar, but omitting for brevity in this replacement block focus)
                    await this.elasticsearchService.indices.putMapping({
                        index: this.index,
                        properties: {
                            partNumber: {
                                type: 'keyword',
                                fields: {
                                    text: { type: 'text', analyzer: 'standard' }
                                }
                            },
                            all_titles: { type: 'text', analyzer: 'standard', search_analyzer: 'standard' }, // Fallback if regular update
                            compatibilities_text: { type: 'text', analyzer: 'standard' },
                            crossReferenceCodes: { type: 'keyword' },
                            crossReferenceBrands: { type: 'keyword' },
                            cross_references_text: { type: 'text', analyzer: 'standard' },
                            all_codes_clean: { type: 'keyword' },
                            totalSold: { type: 'integer' },
                            ratingAverage: { type: 'float' },
                            ratingCount: { type: 'integer' },
                            thumbnail: { type: 'keyword' },
                            brandImage: { type: 'keyword' },
                            quantity: { type: 'integer' },
                            price: { type: 'float' },
                            listPrice: { type: 'float' }, // NEW
                            categories: { type: 'keyword' },
                            categoryIds: { type: 'keyword' }, // NEW
                            description: { type: 'text', analyzer: 'standard' } // NEW
                        }
                    });
                    this.logger.log(`Updated mapping for index: ${this.index} (Analyzers not updated)`);
                } catch (e) {
                    this.logger.warn(`Failed to update mapping: ${e.message}`);
                }
            }
        } catch (error) {
            this.logger.error(`Error checking/creating index: ${error.message}`, error.stack);
        }
    }


    async indexProduct(product: ProductDocument | ProductModel) {
        try {
            // Fetch compatibilities
            let compatibilitiesText = '';
            try {
                this.logger.debug(`Fetching compatibilities for product ${product._id}...`);
                const compatibilities = await this.productCompatibilityService.getCompatibilitiesByProduct(String(product._id));
                this.logger.debug(`Found ${compatibilities?.length || 0} compatibilities for product ${product._id}`);

                if (compatibilities && compatibilities.length > 0) {
                    compatibilitiesText = compatibilities.map(c =>
                        `${c.vehicleBrand || ''} ${c.vehicleName || ''} ${c.vehicleModel || ''} ${c.vehicleYear || ''} ${c.vehicleVersion || ''} ${c.vehicleEngine || ''}`
                    ).join(' ').trim();
                    this.logger.debug(`Generated compatibilities text length: ${compatibilitiesText.length}`);
                }
            } catch (err) {
                this.logger.warn(`Could not fetch compatibilities for product ${product._id}: ${err.message}`);
            }

            // Fetch Cross References
            let crossReferenceCodes: string[] = [];
            let crossReferenceBrands: string[] = [];
            let cross_references_text = '';

            if (product.crossReferenceGroupId) {
                try {
                    const group = await this.crossReferenceService.findGroupById(String(product.crossReferenceGroupId));
                    if (group) {
                        crossReferenceCodes = group.codes.map(c => c.partNumber);
                        crossReferenceBrands = group.codes.map(c => c.brand);
                        cross_references_text = group.codes.map(c => `${c.brand} ${c.partNumber}`).join(' ');
                    }
                } catch (err) {
                    this.logger.warn(`Could not fetch cross references for product ${product._id}: ${err.message}`);
                }
            }

            // Normalize codes for robust search
            // Combine partNumber + crossReferenceCodes based on user request logic
            const codesToNormalize = [product.partNumber, ...crossReferenceCodes].filter(Boolean);
            const all_codes_clean = codesToNormalize.map(c => String(c).replace(/[^a-zA-Z0-9]/g, '').toUpperCase());

            // Fetch Total Sold
            const totalSold = product.totalSold || 0;

            // Thumbnail extraction
            const mainImage = product.images?.find(i => i.main) || product.images?.[0];
            const thumbnail = mainImage ? mainImage.url : null;
            const brandImage = product.brand?.logoUrl || null;

            // Category Logic: Index both Name (for display/legacy) and IDs (for robust filtering)
            const categoriesNames: string[] = [];
            const categoryIds: string[] = [];

            if (product.category) {
                const cat: any = product.category;
                if (cat.name && cat.active !== false) categoriesNames.push(cat.name);
                if ((cat._id || cat.id) && cat.active !== false) categoryIds.push((cat._id || cat.id).toString());

                // Index ancestors if available
                if (cat.ancestors && Array.isArray(cat.ancestors)) {
                    cat.ancestors.forEach((anc: any) => {
                        // Check if it's a full document
                        if (anc && (anc._id || anc.id)) {
                            // Only index if active is NOT false (undefined treated as true for safety, or check strictly)
                            if (anc.active !== false) {
                                categoryIds.push((anc._id || anc.id).toString());
                                if (anc.name) categoriesNames.push(anc.name);
                            }
                        }
                        // Check if it's an ObjectId or string ID
                        else if (anc) {
                            categoryIds.push(anc.toString());
                        }
                    });
                }
            }

            // Fetch Titles (Legacy cleanup)
            const listings = await this.listingService.findByProduct(product._id);
            const productTitles = listings.map(l => l.title);

            // Index optimized fields only
            const body = {
                partNumber: product.partNumber,
                brand: product.brand?.name,
                brandId: product.brand?._id || (product.brand as any)?.id, // Index ID
                categories: categoriesNames,
                categoryIds: [...new Set(categoryIds)], // Unique IDs including ancestors

                name: this.capitalizeText(product.name), // Explicitly index name for display
                all_titles: this.generateOptimizedTitles(
                    product.name,
                    product.partNumber,
                    categoriesNames,
                    productTitles
                ),
                compatibilities_text: compatibilitiesText,
                crossReferenceCodes: crossReferenceCodes,
                crossReferenceBrands: crossReferenceBrands,
                cross_references_text: cross_references_text,
                all_codes_clean: [...new Set(all_codes_clean)], // Unique values
                totalSold: totalSold,
                ratingAverage: product.ratingAverage || 0,
                ratingCount: product.ratingCount || 0,
                thumbnail: thumbnail,
                brandImage: brandImage,
                isGenuine: product.brand?.isGenuine || false,
                quantity: (await this.stockQuery.getProductStock(product._id.toString())).onHand,
                price: product.price ? Number(product.price.toString()) : 0,
                listPrice: product.listPrice ? Number(product.listPrice.toString()) : 0, // NEW
                description: product.description || '' // NEW
            };

            await this.elasticsearchService.index({
                index: this.index,
                id: String(product._id),
                document: body,
            });

            this.logger.debug(`Indexed product ${product._id}`);
        } catch (error) {
            this.logger.error(`Error indexing product ${product._id}: ${error.message}`);
        }
    }

    async getDocument(id: string) {
        try {
            const result = await this.elasticsearchService.get({
                index: this.index,
                id: id
            });
            return result;
        } catch (error) {
            this.logger.error(`Error getting doc ${id}: ${error.message}`);
            return { error: error.message };
        }
    }

    async autocomplete(term: string) {
        try {
            const result = await this.elasticsearchService.search({
                index: this.index,
                body: {
                    size: 5, // Limit suggestions
                    query: {
                        bool: {
                            should: [
                                {
                                    match: {
                                        "partNumber.text": {
                                            query: term
                                        }
                                    }
                                },
                                {
                                    match: {
                                        "all_titles": {
                                            query: term,
                                            fuzziness: "AUTO"
                                        }
                                    }
                                },
                                {
                                    wildcard: {
                                        "partNumber": `*${term}*`
                                    }
                                },
                                {
                                    wildcard: {
                                        "all_codes_clean": `*${term.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}*`
                                    }
                                }
                            ]
                        }
                    }
                } as any
            });

            return result.hits.hits.map(hit => {
                const source = hit._source as any;
                // Prefer part number + first 50 chars of title
                const displayTitle = source.all_titles ? source.all_titles.substring(0, 50) + '...' : '';
                return {
                    label: `${source.partNumber} - ${displayTitle}`,
                    value: source.partNumber,
                    systemId: hit._id,
                    brand: source.brand,
                    brandId: source.brandId
                };
            });
        } catch (error) {
            this.logger.error(`Error autocompleting: ${error.message}`);
            return [];
        }
    }

    async search(query: string, filters: { brand?: string[], category?: string[], categoryId?: string[], ids?: string[], minPrice?: number, maxPrice?: number } = {}, page: number = 1, limit: number = 40) {
        try {
            const mustConditions: any[] = [];
            const filterConditions: any[] = [];

            // Main Query
            if (query) {
                mustConditions.push({
                    function_score: {
                        query: {
                            bool: {
                                should: [
                                    {
                                        multi_match: {
                                            query: query,
                                            fields: [
                                                'partNumber^10',
                                                'partNumber.text^3',
                                                'all_titles',
                                                'compatibilities_text',
                                                'crossReferenceCodes^5',
                                                'crossReferenceBrands',
                                                'cross_references_text',
                                                'description'
                                            ],
                                            fuzziness: 'AUTO'
                                        }
                                    },
                                    // Boost results that contain ALL terms (AND operator)
                                    {
                                        multi_match: {
                                            query: query,
                                            fields: ['name^5', 'all_titles^3'],
                                            operator: "and",
                                            boost: 10.0
                                        }
                                    },
                                    {
                                        match_phrase: {
                                            "all_titles": {
                                                query: query,
                                                boost: 5.0
                                            }
                                        }
                                    },
                                    // Boost if product name starts with the FIRST word of the query (Category match)
                                    {
                                        prefix: {
                                            "name.keyword": {
                                                value: query.split(' ')[0],
                                                case_insensitive: true,
                                                boost: 15.0
                                            }
                                        }
                                    },
                                    // Fallback strict prefix for single word queries or exact entry
                                    {
                                        prefix: {
                                            "name.keyword": {
                                                value: query,
                                                case_insensitive: true,
                                                boost: 5.0
                                            }
                                        }
                                    },
                                    {
                                        wildcard: {
                                            "all_codes_clean": {
                                                value: `*${query.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}*`,
                                                boost: 2.0
                                            }
                                        }
                                    }
                                ]
                            }
                        },
                        functions: [
                            {
                                filter: { range: { quantity: { gt: 0 } } },
                                weight: 10
                            },
                            {
                                field_value_factor: {
                                    field: "totalSold",
                                    factor: 1.2,
                                    modifier: "log1p",
                                    missing: 0
                                }
                            }
                        ],
                        boost_mode: "multiply",
                        score_mode: "sum"
                    }
                });
            }

            // Apply Filters (Filters context - faster, executed after main query logic usually, or as post_filter)
            // Using logic in 'bool' query 'filter' array is standard for faceting if we want facets to reflect filters OR post_filter if we want facets to show ALL options
            // Standard e-commerce: Facets show available options within CURRENT query, but multi-select usually implies OR within group, AND across groups.
            // Simplified: Filters stick.

            if (filters.brand && filters.brand.length > 0) {
                filterConditions.push({ terms: { "brand.keyword": filters.brand } });
            }

            if (filters.category && filters.category.length > 0) {
                filterConditions.push({ terms: { "categories.keyword": filters.category } }); // Using 'categories' field
            }

            if (filters.categoryId && filters.categoryId.length > 0) {
                filterConditions.push({ terms: { categoryIds: filters.categoryId } });
            }

            if (filters.ids && filters.ids.length > 0) {
                filterConditions.push({ terms: { _id: filters.ids } });
            }

            if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
                const range: any = {};
                if (filters.minPrice !== undefined) range.gte = filters.minPrice;
                if (filters.maxPrice !== undefined) range.lte = filters.maxPrice;
                filterConditions.push({ range: { price: range } });
            }

            const pageNum = Number(page) || 1;
            const limitNum = Number(limit) || 40;
            const from = (pageNum - 1) * limitNum;

            const result = await this.elasticsearchService.search({
                index: this.index,
                body: {
                    from: from,
                    size: limitNum,
                    query: {
                        bool: {
                            must: mustConditions,
                            filter: filterConditions
                        }
                    },
                    aggs: {
                        brands: {
                            terms: { field: "brand.keyword", size: 20 }
                        },
                        categories: {
                            terms: { field: "categories.keyword", size: 20 }
                        },
                        price_stats: {
                            stats: { field: "price" }
                        }
                    }
                }
            } as any);

            const hits = result.hits.hits.map(hit => {
                const source = hit._source as any;
                return {
                    _id: hit._id,
                    name: source.name || source.all_titles,
                    partNumber: source.partNumber,
                    brand: {
                        name: source.brand,
                        logoUrl: source.brandImage,
                        isGenuine: source.isGenuine
                    },
                    images: source.thumbnail ? [{ url: source.thumbnail, main: true }] : [],
                    price: source.price,
                    listPrice: source.listPrice, // NEW
                    stockQuantity: source.quantity,
                    totalSold: source.totalSold,
                    ratingAverage: source.ratingAverage,
                    ratingCount: source.ratingCount,
                    description: source.description, // Added description to response
                    score: hit._score
                };
            });

            // Process Facets
            const aggregations = result.aggregations as any;
            const facets = {
                brands: aggregations?.brands?.buckets?.map((b: any) => ({ name: b.key, count: b.doc_count })) || [],
                categories: aggregations?.categories?.buckets?.map((c: any) => ({ name: c.key, count: c.doc_count })) || [],
                price: {
                    min: aggregations?.price_stats?.min || 0,
                    max: aggregations?.price_stats?.max || 0,
                    avg: aggregations?.price_stats?.avg || 0
                }
            };

            return { data: hits, facets }; // Return formatted structure
        } catch (error) {
            this.logger.error(`Error searching: ${error.message}`);
            return { data: [], facets: { brands: [], categories: [], price: { min: 0, max: 0, avg: 0 } } };
        }
    }

    async deleteIndex() {
        try {
            await this.elasticsearchService.indices.delete({ index: this.index });
            this.logger.log(`Deleted index: ${this.index}`);
            return { message: `Index ${this.index} deleted` };
        } catch (error) {
            this.logger.error(`Error deleting index: ${error.message}`);
            throw error;
        }
    }

    private generateOptimizedTitles(name: string, partNumber: string, categories: string[], titles: string[]): string {
        // 1. Initial candidates
        let candidates = [...categories, ...titles];

        // 2. Add name only if it's NOT just the part number (avoid redundancy)
        if (name && partNumber && name.trim().toUpperCase() !== partNumber.trim().toUpperCase()) {
            candidates.push(name);
        }

        // 3. Normalize and Deduplicate
        // Sort by length DESC so we process longest titles first
        let specificTitles = candidates
            .filter(Boolean)
            .map(t => this.capitalizeText(t))
            .sort((a, b) => b.length - a.length);

        // 4. Remove Substrings (Redundancy check)
        const effectiveTitles: string[] = [];

        for (const title of specificTitles) {
            // Check if this title is already contained in a longer title we kept
            const isRedundant = effectiveTitles.some(kept => kept.toLowerCase().includes(title.toLowerCase()));

            if (!isRedundant) {
                effectiveTitles.push(title);
            }
        }

        return effectiveTitles.join(' ');
    }

    private capitalizeText(text: string): string {
        if (!text) return '';
        return text
            .split(' ')
            .map(word => {
                if (word.length <= 2) return word;
                if (word[0] === word[0].toUpperCase()) return word;
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            })
            .join(' ');
    }
}
