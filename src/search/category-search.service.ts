import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CategoryModel } from '../product/schemas/category.schema';

@Injectable()
export class CategorySearchService {
    private readonly logger = new Logger(CategorySearchService.name);
    private readonly searchIndex = 'categories_discovery';

    constructor(
        @InjectModel(CategoryModel.name) private categoryModel: Model<CategoryModel>
    ) {}

    async getTree() {
        try {
            const categories = await this.categoryModel
                .find({ active: true })
                .select('_id name slug parentId ancestors active image relevance')
                .lean()
                .exec();
            return this.buildTree(categories);
        } catch (error) {
            this.logger.error(`Error fetching category tree: ${error.message}`);
            return [];
        }
    }

    private buildTree(categories: any[]) {
        const map = new Map<string, any>();
        const roots: any[] = [];

        categories.forEach(cat => {
            map.set(cat._id.toString(), { ...cat, children: [] });
        });

        categories.forEach(cat => {
            const parentId = cat.parentId?.toString();
            if (parentId && map.has(parentId)) {
                map.get(parentId).children.push(map.get(cat._id.toString()));
            } else {
                roots.push(map.get(cat._id.toString()));
            }
        });

        return roots;
    }

    // Called by ProductCategoryService after create/update operations.
    // Takes the opportunity to persist the pre-computed breadcrumbs field so Atlas Search can index it.
    async indexCategory(category: any, breadcrumbsText?: string) {
        try {
            const breadcrumbs = breadcrumbsText ?? await this.computeBreadcrumbs(category);
            await this.categoryModel.updateOne(
                { _id: category._id },
                { $set: { breadcrumbs } }
            );
        } catch (error) {
            this.logger.error(`Error updating breadcrumbs for category ${category._id}: ${error.message}`);
        }
    }

    // No-op: Atlas Search auto-removes documents deleted from MongoDB.
    async removeCategory(_id: string) {}

    private async computeBreadcrumbs(category: any): Promise<string> {
        if (!category.ancestors || category.ancestors.length === 0) {
            return category.name || '';
        }
        const ancestors = await this.categoryModel
            .find({ _id: { $in: category.ancestors } }, { name: 1 })
            .lean()
            .exec();
        const nameMap = new Map((ancestors as any[]).map(a => [a._id.toString(), a.name]));
        const names = (category.ancestors as any[])
            .map((id: any) => nameMap.get(id.toString()))
            .filter(Boolean) as string[];
        return [...names, category.name].join(' > ');
    }

    async searchCategories(query: string) {
        try {
            return await this.categoryModel.aggregate([
                {
                    $search: {
                        index: this.searchIndex,
                        text: {
                            query,
                            path: ['name', 'synonyms', 'examples'],
                            fuzzy: { maxEdits: 1 },
                        },
                    },
                },
                { $limit: 20 },
            ]).exec();
        } catch (error) {
            this.logger.error(`Error searching categories: ${error.message}`);
            return [];
        }
    }
}
