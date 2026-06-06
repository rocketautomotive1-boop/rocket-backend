import { Injectable, Logger } from '@nestjs/common';
import { IMarketplaceOrderAdapter } from '../interfaces/marketplace-order-adapter.interface';
import { IMarketplaceProductAdapter } from '../interfaces/marketplace-product-adapter.interface';
import { IMarketplaceCategoryAdapter } from '../interfaces/marketplace-category-adapter.interface';
import { IMarketplaceAuthAdapter } from '../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class MarketplaceAdapterRegistry {
    private readonly logger = new Logger(MarketplaceAdapterRegistry.name);
    private orderAdapters = new Map<string, IMarketplaceOrderAdapter>();
    private productAdapters = new Map<string, IMarketplaceProductAdapter>();
    private categoryAdapters = new Map<string, IMarketplaceCategoryAdapter>();
    /** Auth adapters indexados por tag E por name (lookup flexível). FOLHA: sem dep de auth-service. */
    private authAdapters = new Map<string, IMarketplaceAuthAdapter>();

    /**
     * Registra o auth adapter de um marketplace (por tag e por name). É aqui que
     * os adapters se registram — não no MarketplaceAuthService — para que a
     * dependência flua só pra baixo (sem ciclo/forwardRef).
     */
    registerAuthAdapter(adapter: IMarketplaceAuthAdapter) {
        this.logger.log(`Registering Auth Adapter: ${adapter.name} (${adapter.tag})`);
        if (adapter.tag) this.authAdapters.set(adapter.tag, adapter);
        if (adapter.name) this.authAdapters.set(adapter.name, adapter);
    }

    /** Auth adapter por tag ou name. Lança se ausente. */
    getAuthAdapter(tagOrName: string): IMarketplaceAuthAdapter {
        const adapter = this.authAdapters.get(tagOrName);
        if (!adapter) {
            throw new Error(`Auth Adapter not found for: ${tagOrName}`);
        }
        return adapter;
    }

    hasAuthAdapter(tagOrName: string): boolean {
        return this.authAdapters.has(tagOrName);
    }

    registerOrderAdapter(marketplaceName: string, adapter: IMarketplaceOrderAdapter) {
        this.logger.log(`Registering Order Adapter for: ${marketplaceName}`);
        this.orderAdapters.set(marketplaceName, adapter);
    }

    hasOrderAdapter(marketplaceName: string): boolean {
        return this.orderAdapters.has(marketplaceName);
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
