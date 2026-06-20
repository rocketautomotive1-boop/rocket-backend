import { Injectable } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { ShopeeAuthAdapter } from '../shopee/shopee-auth.adapter';
import { ShopeeProductAdapter } from '../shopee/shopee-product.adapter';
import { ShopeeOrderAdapter } from '../shopee/shopee-order.adapter';
import { ShopeeCategoryAdapter } from '../shopee/shopee-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';

@Injectable()
export class ShopeeAdapter extends MarketplaceAdapter {
  name = 'Shopee';

  constructor(
    private readonly authAdapter: ShopeeAuthAdapter,
    private readonly productAdapter: ShopeeProductAdapter,
    private readonly orderAdapter: ShopeeOrderAdapter,
    private readonly categoryAdapter: ShopeeCategoryAdapter
  ) {
    super();
  }

  // Auth methods
  async authenticate(credentials: any): Promise<MarketplaceToken> {
    return this.authAdapter.authenticate(credentials);
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    return this.authAdapter.refreshToken(token);
  }

  // Product methods — token/shopId são resolvidos pelo ShopeeHttpClient (conta no DB),
  // o adapter não recebe mais token por argumento.
  async createProduct(product: any): Promise<any> {
    return this.productAdapter.createProduct(product);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    return this.productAdapter.updateProduct(externalId, product);
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    return this.productAdapter.updateProductImages(externalId, images);
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    return this.productAdapter.updateProductTitle(externalId, title);
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    return this.productAdapter.updateProductCategory(externalId, category);
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    const stock = inventory.stock || inventory.quantity || 0;
    return this.productAdapter.updateProductStock(externalId, Number(stock));
  }

  async updateProductPrice(externalId: string, priceData: any): Promise<any> {
    const price = priceData.price || 0;
    return this.productAdapter.updateProductPrice(externalId, Number(price));
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    return this.productAdapter.validateProduct(product);
  }

  // Order methods
  async getOrders(params: any): Promise<any[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderId: string): Promise<any> {
    return this.orderAdapter.getOrderDetails(orderId);
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderId, status);
  }

  // Category methods
  async getCategories(accessToken: string, shopId: string, parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, shopId, parentId);
  }
}
