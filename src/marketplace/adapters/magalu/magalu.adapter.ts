import { Injectable } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MagaluAuthAdapter } from './magalu-auth.adapter';
import { MagaluProductAdapter } from './magalu-product.adapter';
import { MagaluOrderAdapter } from './magalu-order.adapter';
import { MagaluCategoryAdapter } from './magalu-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { StandardOrder } from '../../model/order.interface';

@Injectable()
export class MagaluAdapter extends MarketplaceAdapter {
  name = 'Magalu';

  constructor(
    private readonly authAdapter: MagaluAuthAdapter,
    private readonly productAdapter: MagaluProductAdapter,
    private readonly orderAdapter: MagaluOrderAdapter,
    public readonly categoryAdapter: MagaluCategoryAdapter,
  ) {
    super();
  }

  // Auth methods
  async authenticate(credentials: any): Promise<MarketplaceToken> {
    const { code, ...additionalData } = credentials;
    return this.authAdapter.authenticate(code, additionalData);
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    return this.authAdapter.refreshToken(token);
  }

  // Product methods — publicação real acontece no orchestrator (magalu-sync.worker.ts),
  // não aqui. Ver comentário em magalu-product.adapter.ts.
  async createProduct(product: any): Promise<any> {
    const result = await this.productAdapter.publishProduct(product, this as any);
    return result;
  }

  async updateProduct(_externalId: string, product: any): Promise<any> {
    const result = await this.productAdapter.publishProduct(product, this as any);
    return result;
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    return this.updateProduct(externalId, { images });
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    return this.updateProduct(externalId, { title });
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    return this.updateProduct(externalId, { category });
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    return this.updateProduct(externalId, { inventory });
  }

  async validateProduct(_product: any): Promise<{ isValid: boolean; missingRequirements: string[] }> {
    return { isValid: true, missingRequirements: [] };
  }

  // Order methods
  async getOrders(params: any): Promise<StandardOrder[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderId: string): Promise<StandardOrder> {
    return this.orderAdapter.getOrderDetails(orderId);
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderId, status);
  }
}
