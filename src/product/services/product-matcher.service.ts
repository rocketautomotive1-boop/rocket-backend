import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductAliasModel } from '../schemas/product-alias.schema';
import { ProductTitleService } from './product-title.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';
import { ProductModel } from '../schemas/product.schema';

@Injectable()
export class ProductMatcherService {
    private readonly logger = new Logger(ProductMatcherService.name);

    constructor(
        private readonly productTitleService: ProductTitleService,
        @InjectModel(ProductAliasModel.name)
        private productAliasModel: Model<ProductAliasModel>,
        @InjectModel(ListingModel.name)
        private listingModel: Model<ListingDocument>,
        @InjectModel(ProductModel.name)
        private productModel: Model<ProductModel>,
    ) { }

    async resolveProduct(
        externalItemId: string,
        itemSku: string,
        marketplaceId?: string,
        itemTitle?: string,
    ): Promise<string | null> {
        // 1. Validations
        const safeExternalId = typeof externalItemId === 'string' ? externalItemId.trim() : '';
        const safeSku = typeof itemSku === 'string' ? itemSku.trim() : '';

        if (!safeExternalId && !safeSku) return null;

        // 2. Strategy 0: Direct _id match
        // If the SKU itself is a valid MongoDB ObjectId, it IS the product._id.
        // Amazon sets SellerSKU = product._id, so no lookup is needed — use it directly.
        if (safeSku && Types.ObjectId.isValid(safeSku)) {
            this.logger.debug(`[Match] S0: sku is a valid ObjectId, using as productId directly: ${safeSku}`);
            return safeSku;
        }

        // 3. Strategy A: Check ProductAlias (Highest Confidence)
        // If marketplaceId is provided, strict match. If not, loose match on externalId
        if (safeExternalId) {
            const aliasQuery: any = { externalId: safeExternalId };
            if (marketplaceId) {
                aliasQuery.marketplaceId = marketplaceId;
            }

            const alias = await this.productAliasModel.findOne(aliasQuery).exec();
            if (alias && alias.product) {
                this.logger.debug(`[Match] Alias found for ${safeExternalId} -> ${alias.product}`);
                return alias.product.toString();
            }
        }

        // 3. Strategy A.5: Check ProductAlias by SKU field (Amazon SellerSKU = product._id)
        if (safeSku) {
            const aliasBySku = await this.productAliasModel.findOne({
                sku: safeSku,
                ...(marketplaceId ? { marketplaceId } : {}),
            }).exec();
            if (aliasBySku?.product) {
                this.logger.debug(`[Match] Alias by SKU found for ${safeSku} -> ${aliasBySku.product}`);
                return aliasBySku.product.toString();
            }
        }

        // 4. Strategy B: Check ProductTitle (Legacy association)
        if (safeExternalId) {
            try {
                const productWithTitle = await this.productTitleService.findByExternalId(safeExternalId);
                if (productWithTitle) {
                    this.logger.debug(`[Match] Title found for ${safeExternalId} -> ${productWithTitle._id}`);
                    return productWithTitle._id.toString();
                }
            } catch (ignore) { }
        }

        // 5. Strategy B2: Listing lookup by SKU as externalId
        // Handles Amazon (SellerSKU = listing.externalId = product._id) and any
        // marketplace where the order item SKU is the same value registered as the listing's externalId.
        if (safeSku && safeSku !== safeExternalId && marketplaceId) {
            try {
                const listingBySku = await this.listingModel
                    .findOne({ marketplaceId: new Types.ObjectId(marketplaceId), externalId: safeSku })
                    .select('productId')
                    .lean()
                    .exec();
                if (listingBySku?.productId) {
                    this.logger.debug(`[Match] B2: resolved via listing.externalId=sku for marketplaceId=${marketplaceId} sku=${safeSku}`);
                    return listingBySku.productId.toString();
                }
            } catch (ignore) { }
        }

        // 6. Strategy C: Title-based fallback (last resort, low confidence)
        // Only attempted when all other strategies failed and a meaningful title is available.
        if (itemTitle && itemTitle.trim().length > 3) {
            try {
                const titleResult = await this.resolveByTitle(itemTitle.trim(), safeExternalId, marketplaceId);
                if (titleResult) {
                    this.logger.debug(`[Match] C: Title match "${itemTitle}" -> ${titleResult}`);
                    return titleResult;
                }
            } catch (ignore) { }
        }

        return null;
    }

    /**
     * Batch-resolve products for multiple order items in as few DB queries as possible.
     * Falls back to individual resolveProduct() only for items that remain unmatched
     * after batch strategies.
     */
    async resolveProducts(
        items: Array<{ externalItemId: string; sku: string; title?: string }>,
        marketplaceId?: string,
    ): Promise<Map<number, string | null>> {
        const results = new Map<number, string | null>();
        const unresolved: number[] = [];

        // Pre-process: sanitize inputs and resolve Strategy 0 (SKU is ObjectId)
        const safeItems = items.map((item, idx) => {
            const safeExternalId = typeof item.externalItemId === 'string' ? item.externalItemId.trim() : '';
            const safeSku = typeof item.sku === 'string' ? item.sku.trim() : '';
            return { idx, safeExternalId, safeSku, title: item.title };
        });

        for (const item of safeItems) {
            if (!item.safeExternalId && !item.safeSku) {
                results.set(item.idx, null);
                continue;
            }
            if (item.safeSku && Types.ObjectId.isValid(item.safeSku)) {
                results.set(item.idx, item.safeSku);
                continue;
            }
            unresolved.push(item.idx);
        }

        if (unresolved.length === 0) return results;

        // Strategy A: Batch ProductAlias by externalId
        const extIdsToCheck = unresolved
            .map(idx => safeItems[idx].safeExternalId)
            .filter(id => !!id);

        if (extIdsToCheck.length > 0) {
            const aliasQuery: any = { externalId: { $in: extIdsToCheck } };
            if (marketplaceId) aliasQuery.marketplaceId = marketplaceId;
            const aliases = await this.productAliasModel.find(aliasQuery).lean().exec();
            const aliasMap = new Map<string, string>();
            for (const a of aliases) {
                if (a.product) aliasMap.set(a.externalId, a.product.toString());
            }
            for (const idx of [...unresolved]) {
                const extId = safeItems[idx].safeExternalId;
                if (extId && aliasMap.has(extId)) {
                    results.set(idx, aliasMap.get(extId));
                    unresolved.splice(unresolved.indexOf(idx), 1);
                }
            }
        }

        if (unresolved.length === 0) return results;

        // Strategy A.5: Batch ProductAlias by SKU
        const skusToCheck = unresolved
            .map(idx => safeItems[idx].safeSku)
            .filter(s => !!s);

        if (skusToCheck.length > 0) {
            const skuQuery: any = { sku: { $in: skusToCheck } };
            if (marketplaceId) skuQuery.marketplaceId = marketplaceId;
            const skuAliases = await this.productAliasModel.find(skuQuery).lean().exec();
            const skuAliasMap = new Map<string, string>();
            for (const a of skuAliases) {
                if (a.product && a.sku) skuAliasMap.set(a.sku, a.product.toString());
            }
            for (const idx of [...unresolved]) {
                const sku = safeItems[idx].safeSku;
                if (sku && skuAliasMap.has(sku)) {
                    results.set(idx, skuAliasMap.get(sku));
                    unresolved.splice(unresolved.indexOf(idx), 1);
                }
            }
        }

        if (unresolved.length === 0) return results;

        // Strategy B: Batch Listing lookup by externalId (replaces ProductTitle.findByExternalId)
        const listingExtIds = unresolved
            .map(idx => safeItems[idx].safeExternalId)
            .filter(id => !!id);

        if (listingExtIds.length > 0) {
            const listingQuery: any = { externalId: { $in: listingExtIds } };
            if (marketplaceId) listingQuery.marketplaceId = new Types.ObjectId(marketplaceId);
            const listings = await this.listingModel.find(listingQuery).select('externalId productId').lean().exec();
            const listingMap = new Map<string, string>();
            for (const l of listings) {
                if (l.productId) listingMap.set(l.externalId, l.productId.toString());
            }
            for (const idx of [...unresolved]) {
                const extId = safeItems[idx].safeExternalId;
                if (extId && listingMap.has(extId)) {
                    results.set(idx, listingMap.get(extId));
                    unresolved.splice(unresolved.indexOf(idx), 1);
                }
            }
        }

        if (unresolved.length === 0) return results;

        // Remaining items: fall back to individual resolution (title match, etc.)
        for (const idx of unresolved) {
            const item = safeItems[idx];
            const result = await this.resolveProduct(
                item.safeExternalId,
                item.safeSku,
                marketplaceId,
                item.title,
            );
            results.set(idx, result);
        }

        return results;
    }

    private async resolveByTitle(
        title: string,
        externalItemId: string,
        marketplaceId?: string,
    ): Promise<string | null> {
        const escaped = this.escapeRegex(title);
        const matches = await this.productModel
            .find({ name: { $regex: `^${escaped}$`, $options: 'i' } })
            .select('_id')
            .lean()
            .limit(2)
            .exec();

        if (matches.length === 0) {
            this.logger.debug(`[Match] C: No title match for "${title}"`);
            return null;
        }

        if (matches.length > 1) {
            this.logger.warn(`[Match] C: Ambiguous title match for "${title}" — ${matches.length} products. Skipping auto-alias.`);
            return null;
        }

        const productId = (matches[0] as any)._id.toString();

        // Auto-create ProductAlias so future lookups resolve instantly
        if (externalItemId && marketplaceId) {
            try {
                await this.productAliasModel.findOneAndUpdate(
                    { marketplaceId: new Types.ObjectId(marketplaceId), externalId: externalItemId },
                    {
                        $setOnInsert: {
                            marketplaceId: new Types.ObjectId(marketplaceId),
                            externalId: externalItemId,
                            product: new Types.ObjectId(productId),
                            source: 'auto-title',
                            confidence: 0.5,
                        },
                    },
                    { upsert: true, new: false },
                ).exec();
            } catch (aliasErr: any) {
                if (aliasErr?.code !== 11000) {
                    this.logger.warn(`[Match] C: Failed to create alias for ${externalItemId}: ${aliasErr.message}`);
                }
            }
        }

        return productId;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
