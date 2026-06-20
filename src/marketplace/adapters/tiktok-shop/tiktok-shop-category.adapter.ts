import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { getTikTokShopBaseUrl, buildSignedParams, buildHeaders } from './tiktok-shop-utils';
import { TikTokShopAuthAdapter } from './tiktok-shop-auth.adapter';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { AuthRetryService } from '../shared/auth-retry.service';

@Injectable()
export class TikTokShopCategoryAdapter implements OnModuleInit {
  private readonly logger = new Logger(TikTokShopCategoryAdapter.name);
  private readonly name = 'TikTok Shop';
  private readonly baseUrl = getTikTokShopBaseUrl();
  private readonly cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour

  constructor(
    @Inject(forwardRef(() => TikTokShopAuthAdapter))
    private readonly authAdapter: TikTokShopAuthAdapter,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly authRetry: AuthRetryService,
  ) {}

  onModuleInit() {
    this.logger.log('TikTokShopCategoryAdapter initialized');
  }

  async getCategories(accessToken: string, shopCipher?: string, locale?: string): Promise<any[]> {
    const cacheKey = `categories:${shopCipher || 'default'}:${locale || 'pt-BR'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const path = '/product/202309/categories';
    const mkt = await this.marketplaceRegistry.findByName(this.name);

    // Auth-retry canônico: no 401 força refresh REAL (antes chamava getValidToken,
    // que só relê o token e nunca renovava) e retenta 1x.
    const categories = await this.authRetry.run(
      { marketplaceId: String(mkt._id), context: 'tiktok.getCategories' },
      async (token) => {
        const cipher = token.additionalData?.shopCipher ?? shopCipher;
        const timestamp = Math.floor(Date.now() / 1000);
        const params = buildSignedParams(path, timestamp, token.accessToken, cipher, {
          locale: locale || 'pt-BR',
        });
        const response = await axios.get(`${this.baseUrl}${path}`, {
          headers: buildHeaders(token.accessToken),
          params,
        });
        return response.data?.data?.categories || [];
      },
    );

    this.setCache(cacheKey, categories);
    return categories;
  }

  async getCategoryRules(categoryId: string, accessToken: string, shopCipher?: string): Promise<any> {
    const cacheKey = `rules:${categoryId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const path = `/product/202309/categories/${categoryId}/rules`;
    const timestamp = Math.floor(Date.now() / 1000);
    const params = buildSignedParams(path, timestamp, accessToken, shopCipher);

    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(accessToken),
        params,
      });

      const rules = response.data?.data || {};
      this.setCache(cacheKey, rules);
      return rules;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar regras da categoria ${categoryId}: ${error.message}`);
      throw error;
    }
  }

  async getCategoryAttributes(categoryId: string, accessToken: string, shopCipher?: string, locale?: string): Promise<any[]> {
    const cacheKey = `attributes:${categoryId}:${locale || 'pt-BR'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const path = `/product/202309/categories/${categoryId}/attributes`;
    const timestamp = Math.floor(Date.now() / 1000);
    const params = buildSignedParams(path, timestamp, accessToken, shopCipher, {
      locale: locale || 'pt-BR',
    });

    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(accessToken),
        params,
      });

      const attributes = response.data?.data?.attributes || [];
      this.setCache(cacheKey, attributes);
      return attributes;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar atributos da categoria ${categoryId}: ${error.message}`);
      throw error;
    }
  }

  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}
