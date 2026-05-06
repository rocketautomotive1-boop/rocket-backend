import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceCategoryModel, MarketplaceCategoryDocument } from '../schemas/marketplace-category.schema';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { ProductCategoryService } from '../../product/services/product-category.service';

@Injectable()
export class MarketplaceCategoryService {
    private readonly logger = new Logger(MarketplaceCategoryService.name);

    constructor(
        @InjectModel(MarketplaceCategoryModel.name)
        private readonly marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,
        private readonly adapterRegistry: MarketplaceAdapterRegistry,
        @Inject(forwardRef(() => ProductCategoryService))
        private readonly productCategoryService: ProductCategoryService,
    ) { }

    /**
     * Ensures a Marketplace Category exists in the database with up-to-date details.
     * If it doesn't exist, fetches from the adapter and creates it.
     * If it exists but is incomplete (missing path structure), updates it.
     */
    async ensureCategory(
        externalId: string,
        marketplace: MarketplaceDocument,
        allowFetch: boolean = true
    ): Promise<MarketplaceCategoryDocument> {
        try {
            // 1. Try to find existing
            let category = await this.marketplaceCategoryModel.findOne({
                externalId: externalId,
                'marketplace._id': marketplace._id
            }).exec();

            if (!category) {
                // Fallback search by marketplace ID directly if stored as ref
                category = await this.marketplaceCategoryModel.findOne({
                    externalId: externalId,
                    marketplace: marketplace._id
                }).exec();
            }

            // 2. Determine if we need to fetch/update
            const needsFetch = !category ||
                (allowFetch && (!category.path_from_root || category.path_from_root.length === 0));

            if (needsFetch) {
                let name = category?.name || externalId;
                let path = category?.path || externalId;
                let pathFromRoot: { id: string; name: string }[] = category?.path_from_root || [];

                // Fetch from Adapter
                const adapter = this.adapterRegistry.getCategoryAdapter(marketplace.name);
                if (adapter && adapter.getCategory) {
                    try {
                        const details = await adapter.getCategory(externalId);
                        if (details) {
                            name = details.name || name;
                            // Standardize path extraction
                            if (details.path_from_root) {
                                pathFromRoot = details.path_from_root;
                                path = pathFromRoot.map(p => p.name).join(' > ');
                            } else if (name) {
                                path = name;
                            }
                        }
                    } catch (err) {
                        this.logger.warn(`Failed to fetch category details for ${externalId} from ${marketplace.name}: ${err.message}`);
                    }
                }

                if (!category) {
                    // Create New
                    category = new this.marketplaceCategoryModel({
                        externalId,
                        name,
                        path,
                        path_from_root: pathFromRoot,
                        marketplace: marketplace._id,
                        isLeaf: true // Assumption, usually we map leaves
                    });
                    await category.save();
                    this.logger.log(`Created new marketplace category: ${name} (${externalId})`);
                } else if (pathFromRoot.length > 0 && (!category.path_from_root || category.path_from_root.length === 0)) {
                    // Use findOneAndUpdate to avoid Mongoose optimistic-locking VersionError
                    // when concurrent requests try to update the same document simultaneously.
                    const updated = await this.marketplaceCategoryModel.findOneAndUpdate(
                        { _id: category._id },
                        { $set: { path_from_root: pathFromRoot, path, name } },
                        { new: true },
                    ).exec();
                    if (updated) category = updated;
                    this.logger.log(`Updated existing marketplace category structure: ${name}`);
                }
            }

            return category;

        } catch (error) {
            this.logger.error(`Error ensuring marketplace category ${externalId}: ${error.message}`, error.stack);
            throw error;
        }
    }

    async ensureInternalCategoryTree(
        marketplaceCategory: MarketplaceCategoryDocument
    ): Promise<string | null> {
        if (!marketplaceCategory.path_from_root || marketplaceCategory.path_from_root.length === 0) {
            // Fallback: If no path but we have a name, try to sync at least the root logic? 
            // Or if name exists, treat as root.
            if (marketplaceCategory.name) {
                // Try to sync just this one level
                return this.syncNode({ id: marketplaceCategory.externalId, name: marketplaceCategory.name }, undefined);
            }
            return null;
        }

        let currentParentId: string | undefined = undefined;

        for (const node of marketplaceCategory.path_from_root) {
            currentParentId = await this.syncNode(node, currentParentId);
        }
        return currentParentId;
    }

    private async syncNode(node: { id: string; name: string }, parentId: string | undefined): Promise<string> {
        const slug = this.generateSlug(node.name);
        let category = null;
        try {
            category = await this.productCategoryService.findBySlug(slug);
        } catch (e) { /* ignore not found */ }

        if (!category) {
            // Create
            category = await this.productCategoryService.create({
                name: node.name,
                parentId: parentId,
                active: true
            } as any);
            this.logger.log(`Created internal category ${node.name} from marketplace structure`);
        } else {
            // Update parent if missing and we have a context parent
            // Only if current category has NO parent, we adopt the provided parent.
            // We avoid re-parenting if it already has one to prevent conflict with manual organization.
            if (!category.parentId && parentId) {
                await this.productCategoryService.update(category._id.toString(), {
                    parentId: parentId
                });
                this.logger.log(`Linked internal category ${node.name} to parent`);
            }
        }
        return category._id.toString();
    }

    private generateSlug(name: string): string {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'cat-' + Math.random().toString(36).substr(2, 5);
    }
}
