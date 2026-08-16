import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MlHttpClient } from './ml-http-client';

/** Catálogo ML: leituras conta-agnósticas (conta default). Token/refresh/retry vivem no MlHttpClient. */
const CTX = (context: string) => ({ context });

@Injectable()
export class MercadoLivreCategoryAdapter implements OnModuleInit {
  private readonly logger = new Logger(MercadoLivreCategoryAdapter.name);
  private name = 'Mercado Livre';

  // Cache simples em memória (Map<key, { data, timestamp }>)
  private cache = new Map<string, { data: any, timestamp: number }>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hora

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: MlHttpClient,
  ) { }

  onModuleInit() {
    this.registry.registerCategoryAdapter(this.name, this);
  }

  private async getCachedRequest<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && (now - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }
    const data = await requestFn();
    this.cache.set(key, { data, timestamp: now });
    return data;
  }

  async getCategories(parentId?: string): Promise<any[]> {
    try {
      if (!parentId) {
        return await this.http.get<any[]>('/sites/MLB/categories', CTX('getCategories'));
      }
      const data = await this.http.get<any>(`/categories/${parentId}`, CTX('getCategories'));
      return data.children_categories || [];
    } catch (error: any) {
      this.logger.error(`Erro na busca de categorias do Mercado Livre: ${error.message}`, error.stack);
      throw new Error(`Falha na busca de categorias do Mercado Livre: ${error.message}`);
    }
  }

  async getCategoryDetails(categoryId: string): Promise<any> {
    const cacheKey = `details:${categoryId}`;
    return this.getCachedRequest(cacheKey, async () => {
      try {
        const [category, attributes] = await Promise.all([
          this.http.get<any>(`/categories/${categoryId}`, CTX('getCategoryDetails')),
          this.http.get<any>(`/categories/${categoryId}/attributes`, CTX('getCategoryDetails')),
        ]);
        return { ...category, attributes };
      } catch (error: any) {
        this.logger.error(`Erro na busca de detalhes da categoria do Mercado Livre: ${error.message}`, error.stack);
        throw new Error(`Falha na busca de detalhes da categoria do Mercado Livre: ${error.message}`);
      }
    });
  }

  async getShippingPreferences(categoryId: string): Promise<any> {
    try {
      return await this.http.get<any>(`/categories/${categoryId}/shipping_preferences`, CTX('getShippingPreferences'));
    } catch (error: any) {
      this.logger.error(`Erro ao buscar preferências de envio: ${error.message}`, error.stack);
      throw new Error(`Falha ao buscar preferências de envio: ${error.message}`);
    }
  }

  async getAllChildCategories(parentId: string): Promise<any[]> {
    try {
      const categoryDetails = await this.getCategoryDetails(parentId);
      if (!categoryDetails.children_categories || categoryDetails.children_categories.length === 0) {
        return [];
      }
      let allCategories: any[] = [];
      for (const child of categoryDetails.children_categories) {
        const childDetails = await this.getCategoryDetails(child.id);
        allCategories.push(childDetails);
        const childCategories = await this.getAllChildCategories(child.id);
        allCategories = [...allCategories, ...childCategories];
      }
      return allCategories;
    } catch (error: any) {
      this.logger.error(`Erro na busca recursiva de subcategorias do Mercado Livre: ${error.message}`, error.stack);
      throw new Error(`Falha na busca recursiva de subcategorias do Mercado Livre: ${error.message}`);
    }
  }

  async getCategory(categoryId: string): Promise<any> {
    const cacheKey = `category:${categoryId}`;
    return this.getCachedRequest(cacheKey, async () => {
      try {
        return await this.http.get<any>(`/categories/${categoryId}`, CTX('getCategory'));
      } catch (error: any) {
        this.logger.error(`Erro ao buscar categoria: ${error.message}`);
        throw error;
      }
    });
  }

  async getCategoryAttributes(categoryId: string): Promise<any> {
    const cacheKey = `attributes:${categoryId}`;
    return this.getCachedRequest(cacheKey, async () => {
      try {
        this.logger.debug(`Fetching attributes for category ID: ${categoryId}`);
        return await this.http.get<any>(`/categories/${categoryId}/attributes`, CTX('getCategoryAttributes'));
      } catch (error: any) {
        this.logger.error(`Erro ao buscar atributos da categoria: ${error.message}`);
        throw error;
      }
    });
  }

  async getCategoryAttributesWithValues(categoryId: string, productId: number): Promise<any> {
    // Stub: product attributes logic pending migration from TypeORM
    return [];
  }

}
