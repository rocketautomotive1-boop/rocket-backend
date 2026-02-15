import { Injectable } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { YampiAuthAdapter } from './yampi-auth.adapter';
import { YampiProductAdapter } from './yampi-product.adapter';
import { YampiOrderAdapter } from './yampi-order.adapter';
import { YampiCategoryAdapter } from './yampi-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';

@Injectable()
export class YampiAdapter extends MarketplaceAdapter {
  name = 'Yampi';

  constructor(
    private readonly authAdapter: YampiAuthAdapter,
    private readonly productAdapter: YampiProductAdapter,
    private readonly orderAdapter: YampiOrderAdapter,
    private readonly categoryAdapter: YampiCategoryAdapter
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
    const accessToken = product.accessToken || product.token;
    const merchantAlias = product.merchantAlias || (product.additionalData && product.additionalData.merchantAlias);

    if (!accessToken) {
      throw new Error('Token de acesso não fornecido para criação de produto na Yampi');
    }

    if (!merchantAlias) {
      throw new Error('Alias do merchant não fornecido para criação de produto na Yampi');
    }

    const productWithData = {
      ...product,
      token: accessToken,
      merchantAlias: merchantAlias
    };

    return this.productAdapter.createProduct(productWithData);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const accessToken = product.accessToken || product.token;
    const merchantAlias = product.merchantAlias || (product.additionalData && product.additionalData.merchantAlias);

    if (!accessToken) {
      throw new Error('Token de acesso não fornecido para atualização de produto na Yampi');
    }

    if (!merchantAlias) {
      throw new Error('Alias do merchant não fornecido para atualização de produto na Yampi');
    }

    const productWithData = {
      ...product,
      token: accessToken,
      merchantAlias: merchantAlias,
      externalId: externalId
    };

    return this.productAdapter.updateProduct(externalId, productWithData);
  }

  async updateProductImages(externalId: string, imageData: any): Promise<any> {
    return this.productAdapter.updateProductImages(externalId, imageData);
  }

  async updateProductTitle(externalId: string, titleData: any): Promise<any> {
    return this.productAdapter.updateProductTitle(externalId, titleData);
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    return this.productAdapter.updateProductCategory(externalId, category);
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    return this.productAdapter.updateProductInventory(externalId, inventory);
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    return this.productAdapter.validateProduct(product);
  }

  // Order methods
  async getOrders(params: any): Promise<any[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderData: any): Promise<any> {
    return this.orderAdapter.getOrderDetails(orderData);
  }

  async updateOrderStatus(orderData: any, status: string): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderData, status);
  }

  // Category methods
  async getCategories(accessToken: string, merchantAlias: string, parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, merchantAlias, parentId);
  }

  // Webhook methods
  async configureWebhook(accessToken: string, webhookData: any): Promise<any> {
    // Implementação básica - pode ser expandida conforme necessário
    return {
      success: true,
      message: 'Webhook configurado com sucesso',
      data: webhookData
    };
  }

  async listWebhooks(accessToken: string): Promise<any[]> {
    // Implementação básica - pode ser expandida conforme necessário
    return [];
  }

  async removeWebhook(accessToken: string, webhookId: string): Promise<any> {
    // Implementação básica - pode ser expandida conforme necessário
    return {
      success: true,
      message: 'Webhook removido com sucesso',
      webhookId: webhookId
    };
  }
}
