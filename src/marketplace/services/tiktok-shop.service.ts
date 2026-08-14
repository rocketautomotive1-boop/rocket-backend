import { Injectable, Logger } from '@nestjs/common';
import { TikTokShopAuthAdapter } from '../adapters/tiktok-shop/tiktok-shop-auth.adapter';
import { TikTokShopOrderAdapter } from '../adapters/tiktok-shop/tiktok-shop-order.adapter';
import { TikTokShopCategoryAdapter } from '../adapters/tiktok-shop/tiktok-shop-category.adapter';

@Injectable()
export class TikTokShopService {
  private readonly logger = new Logger(TikTokShopService.name);

  constructor(
    private readonly authAdapter: TikTokShopAuthAdapter,
    private readonly orderAdapter: TikTokShopOrderAdapter,
    private readonly categoryAdapter: TikTokShopCategoryAdapter,
  ) {}

  // Token/shopCipher são resolvidos dentro do TikTokShopHttpClient (via category
  // adapter), então o service só repassa locale/categoryId.
  async getCategories(locale?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(locale);
  }

  async getCategoryAttributes(categoryId: string, locale?: string): Promise<any[]> {
    return this.categoryAdapter.getCategoryAttributes(categoryId, locale);
  }

  async getCategoryRules(categoryId: string): Promise<any> {
    return this.categoryAdapter.getCategoryRules(categoryId);
  }

  async getOrders(params: any): Promise<any[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderId: string): Promise<any> {
    return this.orderAdapter.getOrderDetails(orderId);
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderId, status);
  }

  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    return this.authAdapter.generateAuthUrl(redirectUri);
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    return this.authAdapter.authenticate(code, additionalData);
  }
}
