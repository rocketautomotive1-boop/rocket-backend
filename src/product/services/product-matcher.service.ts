import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductService } from '../product.service';
import { ProductAliasModel } from '../schemas/product-alias.schema';
import { ProductTitleService } from './product-title.service';

@Injectable()
export class ProductMatcherService {
    private readonly logger = new Logger(ProductMatcherService.name);

    constructor(
        private readonly productService: ProductService,
        private readonly productTitleService: ProductTitleService,
        @InjectModel(ProductAliasModel.name)
        private productAliasModel: Model<ProductAliasModel>,
    ) { }

    async resolveProduct(externalItemId: string, itemSku: string, marketplaceId?: string): Promise<string | null> {
        // 1. Validations
        const safeExternalId = typeof externalItemId === 'string' ? externalItemId.trim() : '';
        const safeSku = typeof itemSku === 'string' ? itemSku.trim() : '';

        if (!safeExternalId && !safeSku) return null;

        // 2. Strategy A: Check ProductAlias (Highest Confidence)
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

        // 3. Strategy B: Check ProductTitle (Legacy association)
        if (safeExternalId) {
            try {
                const productWithTitle = await this.productTitleService.findByExternalId(safeExternalId);
                if (productWithTitle) {
                    this.logger.debug(`[Match] Title found for ${safeExternalId} -> ${productWithTitle._id}`);
                    return productWithTitle._id.toString();
                }
            } catch (ignore) { }
        }

        // 4. Strategy C: SKU Exact Match
        if (safeSku && safeSku !== safeExternalId) {
            // Exclude cases where SKU is just the ExternalID repeated by the marketplace
            try {
                const product = await this.productService.findBySku(safeSku);
                if (product) {
                    this.logger.debug(`[Match] SKU found for ${safeSku} -> ${product._id}`);
                    return product._id.toString();
                }
            } catch (ignore) { }
        }

        return null;
    }
}
