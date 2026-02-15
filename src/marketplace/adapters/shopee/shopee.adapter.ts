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

  // Product methods
  async createProduct(product: any): Promise<any> {
    // Montar objeto de token no formato esperado pelo ProductAdapter
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
        accessToken: product.accessToken || product.token,
        additionalData: { shopId: product.shopId || product.additionalData?.shopId },
      };

    if (!tokenObj?.accessToken) {
      throw new Error('Token de acesso não fornecido para criação de produto na Shopee');
    }
    if (!tokenObj?.additionalData?.shopId) {
      throw new Error('ID da loja não fornecido para criação de produto na Shopee');
    }

    const productWithToken = { ...product, token: tokenObj };
    return this.productAdapter.createProduct(productWithToken);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
        accessToken: product.accessToken || product.token,
        additionalData: { shopId: product.shopId || product.additionalData?.shopId },
      };

    if (!tokenObj?.accessToken) {
      throw new Error('Token de acesso não fornecido para atualização de produto na Shopee');
    }
    if (!tokenObj?.additionalData?.shopId) {
      throw new Error('ID da loja não fornecido para atualização de produto na Shopee');
    }

    const productWithToken = { ...product, token: tokenObj, externalId };
    return this.productAdapter.updateProduct(externalId, productWithToken);
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    return this.productAdapter.updateProductImages(externalId, images);
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    return this.productAdapter.updateProductTitle(externalId, title, undefined as any);
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    return this.productAdapter.updateProductCategory(externalId, category);
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    const stock = inventory.stock || inventory.quantity || 0;
    const token = inventory.token;
    return this.productAdapter.updateProductStock(externalId, Number(stock), token);
  }

  async updateProductPrice(externalId: string, priceData: any): Promise<any> {
    const price = priceData.price || 0;
    const token = priceData.token;
    return this.productAdapter.updateProductPrice(externalId, Number(price), token);
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    return this.productAdapter.validateProduct(product);
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
  async getCategories(accessToken: string, shopId: string, parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, shopId, parentId);
  }
}
