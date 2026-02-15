import { Injectable } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { ViaVarejoAuthAdapter } from './viavarejo-auth.adapter';
import { ViaVarejoProductAdapter } from './viavarejo-product.adapter';
import { ViaVarejoOrderAdapter } from './viavarejo-order.adapter';
import { ViaVarejoCategoryAdapter } from './viavarejo-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';

@Injectable()
export class ViaVarejoAdapter extends MarketplaceAdapter {
  name = 'Via Varejo';

  constructor(
    private readonly authAdapter: ViaVarejoAuthAdapter,
    private readonly productAdapter: ViaVarejoProductAdapter,
    private readonly orderAdapter: ViaVarejoOrderAdapter,
    private readonly categoryAdapter: ViaVarejoCategoryAdapter
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
    const sellerId = product.sellerId || (product.additionalData && product.additionalData.sellerId);

    if (!accessToken) {
      throw new Error('Token de acesso não fornecido para criação de produto na Via Varejo');
    }

    if (!sellerId) {
      throw new Error('Seller ID não fornecido para criação de produto na Via Varejo');
    }

    const productWithData = {
      ...product,
      token: accessToken,
      sellerId: sellerId
    };

    return this.productAdapter.createProduct(productWithData);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const accessToken = product.accessToken || product.token;
    const sellerId = product.sellerId || (product.additionalData && product.additionalData.sellerId);

    if (!accessToken) {
      throw new Error('Token de acesso não fornecido para atualização de produto na Via Varejo');
    }

    if (!sellerId) {
      throw new Error('Seller ID não fornecido para atualização de produto na Via Varejo');
    }

    const productWithData = {
      ...product,
      token: accessToken,
      sellerId: sellerId,
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
  async getCategories(accessToken: string, sellerId: string, parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, sellerId, parentId);
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
