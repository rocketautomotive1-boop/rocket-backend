import { Injectable } from '@nestjs/common';
import { MarketplaceToken } from '../../marketplace/schemas/marketplace-token.schema';
import { StandardOrder } from '../../marketplace/model/order.interface';

/**
 * Interface base para adaptadores de marketplace
 */
export interface IMarketplaceAdapter {
  name: string;

  // Autenticação
  authenticate(credentials: any): Promise<MarketplaceToken>;
  refreshToken(token: MarketplaceToken): Promise<MarketplaceToken>;

  // Operações de produto
  createProduct(product: any): Promise<any>;
  updateProduct(externalId: string, product: any): Promise<any>;
  updateProductImages(externalId: string, images: any[]): Promise<any>;
  updateProductTitle(externalId: string, title: string): Promise<any>;
  updateProductCategory(externalId: string, category: any): Promise<any>;
  updateProductInventory(externalId: string, inventory: any): Promise<any>;

  // Operações de pedido
  getOrders(params: any): Promise<StandardOrder[]>;
  getOrderDetails(orderId: string, token?: any): Promise<StandardOrder>;
  updateOrderStatus(orderId: string, status: string, token?: any): Promise<any>;

  // Validação
  validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }>;
}

/**
 * Classe abstrata base para adaptadores de marketplace
 */
@Injectable()
export abstract class MarketplaceAdapter implements IMarketplaceAdapter {
  abstract name: string;

  abstract authenticate(credentials: any): Promise<MarketplaceToken>;
  abstract refreshToken(token: MarketplaceToken): Promise<MarketplaceToken>;

  abstract createProduct(product: any): Promise<any>;
  abstract updateProduct(externalId: string, product: any): Promise<any>;
  abstract updateProductImages(externalId: string, images: any[]): Promise<any>;
  abstract updateProductTitle(externalId: string, title: string): Promise<any>;
  abstract updateProductCategory(externalId: string, category: any): Promise<any>;
  abstract updateProductInventory(externalId: string, inventory: any): Promise<any>;

  abstract getOrders(params: any): Promise<StandardOrder[]>;
  abstract getOrderDetails(orderId: string, token?: any): Promise<StandardOrder>;
  abstract updateOrderStatus(orderId: string, status: string, token?: any): Promise<any>;

  abstract validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }>;
}
