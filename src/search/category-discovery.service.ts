import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CategoryModel } from '../product/schemas/category.schema';

@Injectable()
export class CategoryDiscoveryService {
    private readonly logger = new Logger(CategoryDiscoveryService.name);
    private readonly searchIndex = 'categories_discovery';

    constructor(
        @InjectModel(CategoryModel.name) private categoryModel: Model<CategoryModel>
    ) {}

    async syncBreadcrumbs(): Promise<{ updated: number }> {
        const categories = await this.categoryModel.find({}).lean().exec();
        const nameMap = new Map<string, string>(
            categories.map((c: any) => [c._id.toString(), c.name])
        );

        let updated = 0;
        for (const cat of categories) {
            const ancestorNames = ((cat as any).ancestors || [])
                .map((id: any) => nameMap.get(id.toString()))
                .filter(Boolean) as string[];
            const breadcrumbs = [...ancestorNames, (cat as any).name].join(' > ');
            await this.categoryModel.updateOne(
                { _id: (cat as any)._id },
                { $set: { breadcrumbs } }
            );
            updated++;
        }

        this.logger.log(`Synced breadcrumbs for ${updated} categories`);
        return { updated };
    }

    // No-op: Atlas Search auto-syncs with MongoDB — no manual indexing required.
    async indexCategory(_category: any) {}

    async discover(query: string): Promise<any[]> {
        try {
            const limitedQuery = query.trim().split(/\s+/).slice(0, 4).join(' ');

            const pipeline: any[] = [
                {
                    $search: {
                        index: this.searchIndex,
                        compound: {
                            should: [
                                {
                                    phrase: {
                                        query: limitedQuery,
                                        path: 'name',
                                        score: { boost: { value: 10 } },
                                    },
                                },
                                {
                                    text: {
                                        query: limitedQuery,
                                        path: 'synonyms',
                                        score: { boost: { value: 8 } },
                                    },
                                },
                                {
                                    text: {
                                        query: limitedQuery,
                                        path: 'name',
                                        fuzzy: { maxEdits: 1 },
                                        score: { boost: { value: 5 } },
                                    },
                                },
                                {
                                    text: {
                                        query: limitedQuery,
                                        path: 'examples',
                                        score: { boost: { value: 3 } },
                                    },
                                },
                                {
                                    text: {
                                        query: limitedQuery,
                                        path: 'breadcrumbs',
                                        score: { boost: { value: 2 } },
                                    },
                                },
                                {
                                    text: {
                                        query: limitedQuery,
                                        path: 'usageGuide',
                                        score: { boost: { value: 1 } },
                                    },
                                },
                            ],
                            minimumShouldMatch: 1,
                        },
                    },
                },
                // $match after $search handles absent/undefined fields correctly,
                // unlike $search.compound.filter which requires the field to exist.
                { $match: { active: { $ne: false }, hidden: { $ne: true } } },
                { $limit: 10 },
                {
                    $project: {
                        id: { $toString: '$_id' },
                        name: 1,
                        breadcrumbs: 1,
                        synonyms: 1,
                        examples: 1,
                        usage: '$usageGuide',
                        attributes: 1,
                        productCount: 1,
                        mappings: '$marketplaceMappings',
                        aiReason: 1,
                        score: { $meta: 'searchScore' },
                    },
                },
            ];

            return await this.categoryModel.aggregate(pipeline).exec();
        } catch (error) {
            this.logger.error(`Error discovering category for "${query}": ${JSON.stringify({ ok: false, message: error.message })}`);
            return [];
        }
    }
}
