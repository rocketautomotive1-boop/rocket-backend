import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TikTokShopHttpClient } from './tiktok-shop-http-client';

@Injectable()
export class TikTokShopCategoryAdapter implements OnModuleInit {
  private readonly logger = new Logger(TikTokShopCategoryAdapter.name);
  private readonly cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 3600000; // 1 hour

  constructor(private readonly http: TikTokShopHttpClient) {}

  onModuleInit() {
    this.logger.log('TikTokShopCategoryAdapter initialized');
  }

  async getCategories(locale?: string): Promise<any[]> {
    const cacheKey = `categories:${locale || 'pt-BR'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Token/shopCipher e auth-retry (refresh real no 401) vivem no TikTokShopHttpClient.
    const data = await this.http.get('/product/202309/categories', { context: 'getCategories' }, {
      locale: locale || 'pt-BR',
    });
    const categories = data?.data?.categories || [];

    this.setCache(cacheKey, categories);
    return categories;
  }

  async getCategoryRules(categoryId: string): Promise<any> {
    const cacheKey = `rules:${categoryId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.get(`/product/202309/categories/${categoryId}/rules`, {
        context: 'getCategoryRules',
      });
      const rules = data?.data || {};
      this.setCache(cacheKey, rules);
      return rules;
    } catch (error: any) {
      this.logger.error(`Erro ao buscar regras da categoria ${categoryId}: ${error.message}`);
      throw error;
    }
  }

  async getCategoryAttributes(categoryId: string, locale?: string): Promise<any[]> {
    const cacheKey = `attributes:${categoryId}:${locale || 'pt-BR'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.get(`/product/202309/categories/${categoryId}/attributes`, {
        context: 'getCategoryAttributes',
      }, { locale: locale || 'pt-BR' });
      const attributes = data?.data?.attributes || [];
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
