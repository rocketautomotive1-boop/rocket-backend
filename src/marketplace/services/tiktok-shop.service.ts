import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { TikTokShopAuthAdapter } from '../adapters/tiktok-shop/tiktok-shop-auth.adapter';
import { TikTokShopProductAdapter } from '../adapters/tiktok-shop/tiktok-shop-product.adapter';
import { TikTokShopOrderAdapter } from '../adapters/tiktok-shop/tiktok-shop-order.adapter';
import { TikTokShopCategoryAdapter } from '../adapters/tiktok-shop/tiktok-shop-category.adapter';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { MarketplaceDescriptionService } from './marketplace-description.service';
import { MarketplaceIntegrationHelperService } from './marketplace-integration-helper.service';

@Injectable()
export class TikTokShopService {
  private readonly logger = new Logger(TikTokShopService.name);

  constructor(
    private readonly authAdapter: TikTokShopAuthAdapter,
    private readonly productAdapter: TikTokShopProductAdapter,
    private readonly orderAdapter: TikTokShopOrderAdapter,
    private readonly categoryAdapter: TikTokShopCategoryAdapter,
    @Inject(forwardRef(() => MarketplaceAuthService))
    private readonly marketplaceAuthService: MarketplaceAuthService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly descriptionService: MarketplaceDescriptionService,
    @Inject(forwardRef(() => MarketplaceIntegrationHelperService))
    private readonly helperService: MarketplaceIntegrationHelperService,
  ) {}

  private async getToken() {
    const marketplace = await this.marketplaceAuthService.findByName('TikTok Shop');
    if (!marketplace) throw new Error('Marketplace TikTok Shop não encontrado');
    return this.marketplaceAuthService.ensureValidToken(marketplace._id as any);
  }

  async getCategories(locale?: string): Promise<any[]> {
    const token = await this.getToken();
    const shopCipher = token.additionalData?.shopCipher;
    return this.categoryAdapter.getCategories(token.accessToken, shopCipher, locale);
  }

  async getCategoryAttributes(categoryId: string, locale?: string): Promise<any[]> {
    const token = await this.getToken();
    const shopCipher = token.additionalData?.shopCipher;
    return this.categoryAdapter.getCategoryAttributes(categoryId, token.accessToken, shopCipher, locale);
  }

  async getCategoryRules(categoryId: string): Promise<any> {
    const token = await this.getToken();
    const shopCipher = token.additionalData?.shopCipher;
    return this.categoryAdapter.getCategoryRules(categoryId, token.accessToken, shopCipher);
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
