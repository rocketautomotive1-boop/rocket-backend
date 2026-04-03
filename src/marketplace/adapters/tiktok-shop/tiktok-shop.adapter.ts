import { Injectable } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { TikTokShopAuthAdapter } from './tiktok-shop-auth.adapter';
import { TikTokShopProductAdapter } from './tiktok-shop-product.adapter';
import { TikTokShopOrderAdapter } from './tiktok-shop-order.adapter';
import { TikTokShopCategoryAdapter } from './tiktok-shop-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';

@Injectable()
export class TikTokShopAdapter extends MarketplaceAdapter {
  name = 'TikTok Shop';

  constructor(
    private readonly authAdapter: TikTokShopAuthAdapter,
    private readonly productAdapter: TikTokShopProductAdapter,
    private readonly orderAdapter: TikTokShopOrderAdapter,
    private readonly categoryAdapter: TikTokShopCategoryAdapter,
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

  // Product methods
  async createProduct(product: any): Promise<any> {
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
          accessToken: product.accessToken || product.token,
          additionalData: { shopCipher: product.shopCipher || product.additionalData?.shopCipher },
        };

    if (!tokenObj?.accessToken) {
      throw new Error('Token de acesso não fornecido para criação de produto no TikTok Shop');
    }

    const productWithToken = { ...product, token: tokenObj };
    return this.productAdapter.publishProduct(productWithToken, product.marketplace);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
          accessToken: product.accessToken || product.token,
          additionalData: { shopCipher: product.shopCipher || product.additionalData?.shopCipher },
        };

    if (!tokenObj?.accessToken) {
      throw new Error('Token de acesso não fornecido para atualização de produto no TikTok Shop');
    }

    const productWithToken = { ...product, token: tokenObj, externalId };
    return this.productAdapter.publishProduct(productWithToken, product.marketplace, externalId);
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    // Images are updated as part of the full product update
    return { success: true, message: 'Images updated via product update' };
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    // Title is updated as part of the full product update
    return { success: true, message: 'Title updated via product update' };
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    // Category is updated as part of the full product update
    return { success: true, message: 'Category updated via product update' };
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    // Inventory is handled by the sync worker
    return { success: true, message: 'Inventory updated via sync worker' };
  }

  async validateProduct(product: any): Promise<{ isValid: boolean; missingRequirements: string[] }> {
    const missingRequirements: string[] = [];

    if (!product.name && !product.title) missingRequirements.push('title');
    if (!product.price || product.price <= 0) missingRequirements.push('price');
    if (!product.images || product.images.length === 0) missingRequirements.push('images');
    if (!product.description) missingRequirements.push('description');

    return {
      isValid: missingRequirements.length === 0,
      missingRequirements,
    };
  }

  // Order methods
  async getOrders(params: any): Promise<any[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderId: string, token?: any): Promise<any> {
    return this.orderAdapter.getOrderDetails(orderId, token);
  }

  async updateOrderStatus(orderId: string, status: string, token?: any): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderId, status, token);
  }

  // Category methods
  async getCategories(accessToken: string, shopCipher?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, shopCipher);
  }
}
