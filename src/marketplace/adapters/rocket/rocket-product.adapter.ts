import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { CategoryDiscoveryService } from '../../../search/category-discovery.service';
import { PRICING_PORT, PricingPort } from '../../../pricing/ports/pricing.port';

@Injectable()
export class RocketProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
    private readonly name = 'Rocket';

    constructor(
        private readonly registry: MarketplaceAdapterRegistry,
        private readonly categoryDiscoveryService: CategoryDiscoveryService,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    ) { }

    onModuleInit() {
        this.registry.registerProductAdapter(this.name, this);
    }

    async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
        try {
            // Predict Category (best match = first result)
            const discoveryResults = await this.categoryDiscoveryService.discover(product.name);
            const predictedCategory = discoveryResults?.[0] ?? null;
            const predictedCategoryId = predictedCategory ? predictedCategory.id : 'UNCATEGORIZED';
            const predictedCategoryName = predictedCategory ? predictedCategory.name : 'Uncategorized';

            // Simulate Publication
            const newExternalId = externalId || `ROCKET-${product._id}-${Date.now()}`;
            const salePrice = await this.pricing.getEffectivePrice(String(product._id), String(marketplace?._id ?? ''));

            return {
                success: true,
                externalId: newExternalId,
                status: 'active',
                marketplaceData: {
                    predictedCategory: {
                        id: predictedCategoryId,
                        name: predictedCategoryName,
                        score: predictedCategory?.score
                    }
                },
                requestPayload: {
                    title: product.name,
                    price: salePrice,
                },
                responsePayload: {
                    id: newExternalId,
                    category_id: predictedCategoryId
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Required Interface Methods (Stubs)
    async createProduct(context: any): Promise<any> { return this.publishProduct(context, {} as any); }
    async updateProduct(externalId: string, context: any): Promise<any> { return this.publishProduct(context, {} as any, externalId); }
    async getListings(params: any): Promise<any[]> { return []; }
    async getListingDetail(externalId: string): Promise<any> { return {}; }
}
