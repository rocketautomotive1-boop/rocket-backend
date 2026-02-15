import { ProductAttributesService } from '../../services/product-attributes.service';
import { Inject, forwardRef, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

@Injectable()
export class MercadoLivreCategoryAdapter implements OnModuleInit {
  private readonly logger = new Logger(MercadoLivreCategoryAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';
  private name = 'Mercado Livre';

  // Cache simples em memória (Map<key, { data, timestamp }>)
  private cache = new Map<string, { data: any, timestamp: number }>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hora

  constructor(
    @Inject(forwardRef(() => MercadoLivreAuthAdapter))
    private readonly authAdapter: MercadoLivreAuthAdapter,
    private readonly registry: MarketplaceAdapterRegistry
  ) { }

  onModuleInit() {
    this.registry.registerCategoryAdapter(this.name, this);
  }

  /**
   * Helper para cache simples em memória
   */
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

  /**
   * Chamada ao Mercado Livre com retry forçado de token em caso de 401.
   */
  private async requestWithRetry(config: any): Promise<any> {
    try {
      return await axios(config);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401) {
        this.logger.warn('Token Mercado Livre possivelmente expirado. Tentando refresh e retry...');
        try {
          const refreshed = await this.authAdapter.forceRefreshAccessToken(this.name);
          const retryConfig = {
            ...config,
            headers: {
              ...(config.headers || {}),
              Authorization: `Bearer ${refreshed}`,
            },
          };
          return await axios(retryConfig);
        } catch (err) {
          this.logger.error('Falha ao refrescar token do Mercado Livre.', err);
        }
      }
      throw error;
    }
  }

  async getCategories(accessToken: string, parentId?: string): Promise<any[]> {

    try {
      // Se não tiver parentId, busca as categorias raiz
      if (!parentId) {
        const response = await this.requestWithRetry({
          method: 'get',
          url: `${this.baseUrl}/sites/MLB/categories`,
          headers: { Authorization: `Bearer ${accessToken}` },
        });


        return response.data;
      }

      // Se tiver parentId, busca a categoria específica e suas subcategorias
      const response = await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/categories/${parentId}`,
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // Extrai as subcategorias do resultado
      const childrenCategories = response.data.children_categories || [];



      return childrenCategories;
    } catch (error) {
      this.logger.error(`Erro na busca de categorias do Mercado Livre: ${error.message}`, error.stack);
      throw new Error(`Falha na busca de categorias do Mercado Livre: ${error.message}`);
    }
  }

  async getCategoryDetails(accessToken: string, categoryId: string): Promise<any> {
    const cacheKey = `details:${categoryId}`;

    return this.getCachedRequest(cacheKey, async () => {


      try {
        // Primeira chamada para obter os detalhes básicos da categoria
        const categoryResponse = await this.requestWithRetry({
          method: 'get',
          url: `${this.baseUrl}/categories/${categoryId}`,
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        // Segunda chamada para obter os atributos da categoria
        const attributesResponse = await this.requestWithRetry({
          method: 'get',
          url: `${this.baseUrl}/categories/${categoryId}/attributes`,
          headers: { Authorization: `Bearer ${accessToken}` },
        });



        // Combinar os resultados
        return {
          ...categoryResponse.data,
          attributes: attributesResponse.data
        };
      } catch (error) {
        this.logger.error(`Erro na busca de detalhes da categoria do Mercado Livre: ${error.message}`, error.stack);
        throw new Error(`Falha na busca de detalhes da categoria do Mercado Livre: ${error.message}`);
      }
    });
  }

  async getShippingPreferences(accessToken: string, categoryId: string): Promise<any> {

    try {
      const response = await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/categories/${categoryId}/shipping_preferences`,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao buscar preferências de envio: ${error.message}`, error.stack);
      throw new Error(`Falha ao buscar preferências de envio: ${error.message}`);
    }
  }

  async getAllChildCategories(accessToken: string, parentId: string): Promise<any[]> {


    try {
      // Busca os detalhes da categoria pai
      const categoryDetails = await this.getCategoryDetails(accessToken, parentId);

      // Se não tiver subcategorias, retorna um array vazio
      if (!categoryDetails.children_categories || categoryDetails.children_categories.length === 0) {

        return [];
      }

      // Extrai as subcategorias diretas
      const directChildren = categoryDetails.children_categories;


      // Array para armazenar todas as subcategorias (diretas e indiretas)
      let allCategories = [];

      // Para cada subcategoria direta, busca seus detalhes completos e recursivamente suas subcategorias
      for (const child of directChildren) {
        // Busca detalhes completos da subcategoria
        const childDetails = await this.getCategoryDetails(accessToken, child.id);

        // Adiciona a subcategoria com detalhes completos ao array
        allCategories.push(childDetails);

        // Busca recursivamente as subcategorias da subcategoria atual
        const childCategories = await this.getAllChildCategories(accessToken, child.id);

        // Adiciona as subcategorias encontradas ao array de todas as categorias
        allCategories = [...allCategories, ...childCategories];
      }



      return allCategories;
    } catch (error) {
      this.logger.error(`Erro na busca recursiva de subcategorias do Mercado Livre: ${error.message}`, error.stack);
      throw new Error(`Falha na busca recursiva de subcategorias do Mercado Livre: ${error.message}`);
    }
  }

  async discoverCategory(accessToken: string, title: string): Promise<any> {


    try {
      const response = await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/sites/MLB/domain_discovery/search`,
        params: { q: title },
        headers: { Authorization: `Bearer ${accessToken}` },
      });



      if (!response.data || response.data.length === 0) {
        this.logger.error('Resposta vazia da API do Mercado Livre');
        throw new Error('Nenhuma categoria encontrada para o título fornecido');
      }

      const suggestedCategory = response.data[0];

      // Mapear os campos da resposta para o formato esperado
      const mappedCategory = {
        category_id: suggestedCategory.category_id,
        name: suggestedCategory.category_name, // Mapeando category_name para name
        domain_id: suggestedCategory.domain_id,
        domain_name: suggestedCategory.domain_name,
        attributes: suggestedCategory.attributes || []
      };



      if (!mappedCategory.category_id || !mappedCategory.name) {
        this.logger.error('Resposta inválida do Mercado Livre:', {
          hasCategoryId: !!mappedCategory.category_id,
          hasName: !!mappedCategory.name,
          rawResponse: suggestedCategory
        });
        throw new Error('Resposta inválida do Mercado Livre: categoria incompleta');
      }



      return mappedCategory;
    } catch (error) {
      if (error.response) {
        this.logger.error('Erro na resposta da API:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
      }
      this.logger.error(`Erro na busca de categoria sugerida: ${error.message}`, error.stack);
      throw new Error(`Falha na busca de categoria sugerida: ${error.message}`);
    }
  }

  async domainDiscovery(title: string): Promise<any> {
    try {
      if (!title) {
        throw new Error('Título não fornecido para busca de domínio');
      }

      const accessToken = await this.authAdapter.getValidToken(this.name);
      if (!accessToken) {
        throw new Error(`Não consegui obter o token de acesso para ${this.name}.`);
      }

      const domainDiscovery = await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/sites/MLB/domain_discovery/search`,
        params: { q: title },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!domainDiscovery.data || domainDiscovery.data.length === 0) {
        throw new Error('Nenhum domínio encontrado para o título fornecido');
      }

      return domainDiscovery.data;
    } catch (error) {
      this.logger.error(`Erro ao buscar domínio sugerido: ${error.message}`);
      throw error;
    }
  }

  async getDomainAndCategories(title: string): Promise<any> {
    try {
      if (!title) {
        throw new Error('Título não fornecido para busca de domínio e categorias');
      }

      const accessToken = await this.authAdapter.getValidToken(this.name);
      if (!accessToken) {
        throw new Error(`Não consegui obter o token de acesso para ${this.name}.`);
      }

      const domain = await this.domainDiscovery(title);
      if (!Array.isArray(domain)) {
        throw new Error('Resposta inválida do Mercado Livre: domínio não é um array.');
      }

      const enrichedDomain = await Promise.all(domain.map(async (domainItem: any) => {
        const category = await this.getCategory(domainItem.category_id);
        if (!category) {
          throw new Error(`Não foi possível obter a categoria: ${domainItem.category_id}.`);
        }

        // Optimization: Fetch Shipping Preferences (Dimensions)
        let dimensions = null;
        try {
          const prefs = await this.getShippingPreferences(accessToken, domainItem.category_id);
          if (prefs && prefs.dimensions) {
            dimensions = prefs.dimensions;
          }
        } catch (ignored) {
          // Ignore error if preferences fetch fails, it's optional
        }

        // Return enriched object (Category + Dimensions)
        // We attach dimensions to the category object itself for persistence later
        const categoryWithDimensions = {
          ...category,
          dimensions: dimensions
        };

        return { ...domainItem, category: categoryWithDimensions };
      }));
      return enrichedDomain;
    } catch (error) {
      this.logger.error(`Erro ao buscar domínio e categorias: ${error.message}`);
      throw error;
    }
  }

  async getCategory(categoryId: string): Promise<any> {
    const cacheKey = `category:${categoryId}`;

    return this.getCachedRequest(cacheKey, async () => {
      try {
        const accessToken = await this.authAdapter.getValidToken(this.name);
        if (!accessToken) {
          throw new Error(`Não consegui obter o token de acesso para ${this.name}.`);
        }

        const category = await this.requestWithRetry({
          method: 'get',
          url: `${this.baseUrl}/categories/${categoryId}`,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!category) {
          throw new Error('Não foi possível obter a categoria');
        }
        return category.data;
      } catch (error) {
        this.logger.error(`Erro ao buscar categoria: ${error.message}`);
        throw error;
      }
    });
  }

  async getCategoryAttributes(categoryId: string): Promise<any> {
    const cacheKey = `attributes:${categoryId}`;

    return this.getCachedRequest(cacheKey, async () => {
      try {
        const accessToken = await this.authAdapter.getValidToken(this.name);
        if (!accessToken) {
          throw new Error(`Não consegui obter o token de acesso para ${this.name}.`);
        }
        this.logger.debug(`Fetching attributes for category ID: ${categoryId}`);
        const attributes = await this.requestWithRetry({
          method: 'get',
          url: `${this.baseUrl}/categories/${categoryId}/attributes`,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        return attributes.data;
      } catch (error) {
        this.logger.error(`Erro ao buscar atributos da categoria: ${error.message}`);
        throw error;
      }
    });
  }

  async getCategoryAttributesWithValues(categoryId: string, productId: number): Promise<any> {
    // Stub: product attributes logic pending migration from TypeORM
    return [];
  }

  async getDomainWithCategoryAndAttributes(title: any): Promise<any> {
    try {
      const accessToken = await this.authAdapter.getValidToken(this.name);
      if (!accessToken) {
        throw new Error(`Não consegui obter o token de acesso para ${this.name}.`);
      }
      const domain = await this.domainDiscovery(title);
      for (const domainItem of domain) {
        const category = await this.getCategory(domainItem.category_id);
        if (!category) {
          throw new Error('Não foi possível obter a categoria');
        }

        const attributes = await this.getCategoryAttributes(domainItem.category_id);
        if (!attributes) {
          throw new Error('Não foi possível obter os atributos da categoria');
        }

        return {
          category: category,
          attributes: attributes
        };
      }
    } catch (error) {
      this.logger.error(`Erro ao buscar domínio com categoria e atributos: ${error.message}`);
      throw error;
    }
  }
}