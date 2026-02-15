import { Injectable, Logger } from '@nestjs/common';
import { IMarketplaceOrderAdapter } from '../interfaces/marketplace-order-adapter.interface';
import { IMarketplaceProductAdapter } from '../interfaces/marketplace-product-adapter.interface';
import { IMarketplaceCategoryAdapter } from '../interfaces/marketplace-category-adapter.interface';

@Injectable()
export class MarketplaceAdapterRegistry {
    private readonly logger = new Logger(MarketplaceAdapterRegistry.name);
    private orderAdapters = new Map<string, IMarketplaceOrderAdapter>();
    private productAdapters = new Map<string, IMarketplaceProductAdapter>();
    private categoryAdapters = new Map<string, IMarketplaceCategoryAdapter>();

    registerOrderAdapter(marketplaceName: string, adapter: IMarketplaceOrderAdapter) {
        this.logger.log(`Registering Order Adapter for: ${marketplaceName}`);
        this.orderAdapters.set(marketplaceName, adapter);
    }

    getOrderAdapter(marketplaceName: string): IMarketplaceOrderAdapter {
        const adapter = this.orderAdapters.get(marketplaceName);
        if (!adapter) {
            throw new Error(`Order Adapter not found for marketplace: ${marketplaceName}`);
        }
        return adapter;
    }

    registerProductAdapter(marketplaceName: string, adapter: IMarketplaceProductAdapter) {
        this.logger.log(`Registering Product Adapter for: ${marketplaceName}`);
        this.productAdapters.set(marketplaceName, adapter);
    }

    getProductAdapter(marketplaceName: string): IMarketplaceProductAdapter {
        const adapter = this.productAdapters.get(marketplaceName);
        if (!adapter) {
            throw new Error(`Product Adapter not found for marketplace: ${marketplaceName}`);
        }
        return adapter;
    }

    registerCategoryAdapter(marketplaceName: string, adapter: IMarketplaceCategoryAdapter) {
        this.logger.log(`Registering Category Adapter for: ${marketplaceName}`);
        this.categoryAdapters.set(marketplaceName, adapter);
    }

    getCategoryAdapter(marketplaceName: string): IMarketplaceCategoryAdapter {
        const adapter = this.categoryAdapters.get(marketplaceName);
        if (!adapter) {
            throw new Error(`Category Adapter not found for marketplace: ${marketplaceName}`);
        }
        return adapter;
    }
}
