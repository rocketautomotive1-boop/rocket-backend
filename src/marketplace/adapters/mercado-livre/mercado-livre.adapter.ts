import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MercadoLivreAuthAdapter } from '../mercado-livre/mercado-livre-auth.adapter';
import { MercadoLivreProductAdapter } from '../mercado-livre/mercado-livre-product.adapter';
import { MercadoLivreOrderAdapter } from '../mercado-livre/mercado-livre-order.adapter';
import { MercadoLivreCategoryAdapter } from '../mercado-livre/mercado-livre-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import axios from 'axios';

@Injectable()
export class MercadoLivreAdapter extends MarketplaceAdapter {
  name = 'Mercado Livre';
  private readonly logger = new Logger(MercadoLivreAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';

  constructor(
    @Inject(forwardRef(() => MercadoLivreAuthAdapter))
    private readonly authAdapter: MercadoLivreAuthAdapter,
    @Inject(forwardRef(() => MercadoLivreProductAdapter))
    private readonly productAdapter: MercadoLivreProductAdapter,
    @Inject(forwardRef(() => MercadoLivreOrderAdapter))
    private readonly orderAdapter: MercadoLivreOrderAdapter,
    @Inject(forwardRef(() => MercadoLivreCategoryAdapter))
    public readonly categoryAdapter: MercadoLivreCategoryAdapter
  ) {
    super();
  }

  // Auth methods
  async authenticate(credentials: any): Promise<MarketplaceToken> {
    // Extract code and pass rest as additionalData
    const { code, ...additionalData } = credentials;
    return this.authAdapter.authenticate(code, additionalData);
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    return this.authAdapter.refreshToken(token);
  }

  // Product methods
  async createProduct(product: any): Promise<any> {
    const result = await this.productAdapter.publishProduct(product, this as any);
    return result.results?.[0] || result;
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const result = await this.productAdapter.publishProduct(product, this as any);
    return result.results?.find(r => r.externalId === externalId) || result.results?.[0] || result;
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    // Mercado Livre partial updates are handled through individual fields in PUT /items
    return this.updateProduct(externalId, { productImages: images });
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    return this.updateProduct(externalId, { productTitles: [{ title }] });
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    const categoryId = typeof category === 'string' ? category : (category.id || category.externalId);
    return this.updateProduct(externalId, { category_id: categoryId });
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    return this.updateProduct(externalId, { inventory: [inventory], ...inventory });
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    return { isValid: true, missingRequirements: [] };
  }

  // Order methods
  async getOrders(params: any): Promise<any[]> {
    return this.orderAdapter.getOrders(params);
  }

  async getOrderDetails(orderId: string): Promise<any> {
    return this.orderAdapter.getOrderDetails(orderId);
  }

  async getBillingInfo(billingId: string): Promise<any> {
    return this.orderAdapter.getBillingInfo(billingId);
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    return this.orderAdapter.updateOrderStatus(orderId, status);
  }

  // Category methods
  async getCategories(accessToken: string, parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(accessToken, parentId);
  }

  // Métodos adicionais para categorias
  async getAllChildCategories(accessToken: string, parentId: string): Promise<any[]> {
    return this.categoryAdapter.getAllChildCategories(accessToken, parentId);
  }

  async getCategoryAttributes(categoryId: string): Promise<any> {
    const url = `https://api.mercadolibre.com/categories/${categoryId}/attributes`;
    const response = await axios.get(url);
    return response.data;
  }

  async getCategoryPreferences(categoryId: string): Promise<any> {
    this.logger.log(`Fetching category preferences for: ${categoryId}`);
    const url = `https://api.mercadolibre.com/categories/${categoryId}`;

    try {
      const response = await axios.get(url);
      const categoryData = response.data;

      this.logger.log(`ML Category Data for ${categoryId}: ${JSON.stringify(categoryData.settings)}`); // Debug log

      // Extract preferences including default dimensions and weight
      // Note: settings object structure isn't guaranteed, so we map safely
      return {
        default_weight: categoryData.settings?.shipping_profile?.weight || categoryData.settings?.default_weight,
        default_dimensions: categoryData.settings?.shipping_profile?.dimensions || categoryData.settings?.default_dimensions,
        max_listing_price: categoryData.settings?.max_listing_price,
        min_listing_price: categoryData.settings?.min_listing_price,
        listing_allowed: categoryData.settings?.listing_allowed,
        show_contact_information: categoryData.settings?.show_contact_information,
        ...categoryData.settings
      };
    } catch (error) {
      this.logger.error(`Error fetching category preferences: ${error.message}`);
      throw error;
    }
  }

  async getCategoryDetails(accessToken: string, categoryId: string): Promise<any> {
    this.logger.log(`Buscando detalhes da categoria ${categoryId}`);

    try {
      const response = await axios.get(`${this.baseUrl}/categories/${categoryId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      this.logger.log(`Detalhes da categoria ${categoryId} obtidos com sucesso`);

      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao buscar detalhes da categoria: ${error.message}`);
      throw error;
    }
  }

  async getShippingPreferences(accessToken: string, categoryId: string): Promise<any> {
    return this.categoryAdapter.getShippingPreferences(accessToken, categoryId);
  }

  async discoverCategory(accessToken: string, title: string): Promise<any> {
    if (!title) {
      throw new Error('Título não fornecido para busca de categoria');
    }

    if (!accessToken) {
      throw new Error('Token de acesso não fornecido');
    }

    this.logger.log(`Buscando categoria recomendada para o título: ${title}`);

    try {
      const response = await axios.get(`${this.baseUrl}/sites/MLB/domain_discovery/search`, {
        params: {
          q: title
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('Nenhuma categoria encontrada para o título fornecido');
      }

      const suggestedCategory = response.data[0];

      if (!suggestedCategory || !suggestedCategory.category_id) {
        throw new Error('Resposta inválida do Mercado Livre: categoria não encontrada');
      }

      this.logger.log(`Categoria sugerida encontrada: ${suggestedCategory.name} (${suggestedCategory.category_id})`);

      return {
        category_id: suggestedCategory.category_id,
        name: suggestedCategory.name,
        domain_id: suggestedCategory.domain_id,
        domain_name: suggestedCategory.domain_name
      };
    } catch (error) {
      if (error.response?.status === 401) {
        this.logger.debug('Token expirado, será renovado automaticamente');
        throw error;
      }

      this.logger.error(`Erro na busca de categoria sugerida: ${error.message}`);

      if (error.response) {
        this.logger.error(`Resposta do Mercado Livre: ${JSON.stringify(error.response.data)}`);
        throw new Error(`Falha na busca de categoria sugerida: ${error.response.data.message || error.message}`);
      }

      throw new Error(`Falha na busca de categoria sugerida: ${error.message}`);
    }
  }

  // Q&A Methods
  async answerQuestion(questionId: string, text: string): Promise<any> {
    throw new Error('Method requires accessToken. Please update Service to pass it.');
  }

  async answerQuestionWithToken(accessToken: string, questionId: string, text: string): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/answers`, {
        question_id: Number(questionId),
        text: text
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao responder pergunta ${questionId}: ${error.message}`);
      throw error;
    }
  }

  async getQuestionById(accessToken: string, questionId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/questions/${questionId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Erro ao buscar pergunta ${questionId}: ${error.message}`);
      throw error;
    }
  }

  async getQuestions(accessToken: string, sellerId: string, status?: 'UNANSWERED' | 'ANSWERED'): Promise<any[]> {
    try {
      const allQuestions: any[] = [];
      const limit = 50; // ML API limit per request
      const maxQuestions = 200; // Total we want to fetch
      let offset = 0;

      // Fetch multiple pages
      while (offset < maxQuestions) {
        const params: any = {
          sort: 'date_created_desc',
          limit: limit,
          offset: offset
        };

        if (status) {
          params.status = status;
        }

        const response = await axios.get(`${this.baseUrl}/questions/search?seller_id=${sellerId}&sort_fields=item_id,date_created&api_version=4`, {
          params,
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });


        const questions = response.data.questions || [];
        allQuestions.push(...questions);

        // If we got less than limit, we've reached the end
        if (questions.length < limit) {
          break;
        }

        offset += limit;
      }

      this.logger.log(`Fetched ${allQuestions.length} questions from Mercado Livre`);
      return allQuestions;
    } catch (error) {
      this.logger.error(`Erro ao buscar perguntas: ${error.message}`);
      throw error;
    }
  }
}
