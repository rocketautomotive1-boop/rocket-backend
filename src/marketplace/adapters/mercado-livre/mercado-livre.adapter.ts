import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MercadoLivreAuthAdapter } from '../mercado-livre/mercado-livre-auth.adapter';
import { MercadoLivreProductAdapter } from '../mercado-livre/mercado-livre-product.adapter';
import { MercadoLivreOrderAdapter } from '../mercado-livre/mercado-livre-order.adapter';
import { MercadoLivreCategoryAdapter } from '../mercado-livre/mercado-livre-category.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { MlHttpClient } from './ml-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';
import axios from 'axios';

@Injectable()
export class MercadoLivreAdapter extends MarketplaceAdapter {
  name = 'Mercado Livre';
  private readonly logger = new Logger(MercadoLivreAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';

  // Sem forwardRef: nenhum destes adapters importa o guarda-chuva de volta (sem ciclo).
  constructor(
    private readonly authAdapter: MercadoLivreAuthAdapter,
    private readonly productAdapter: MercadoLivreProductAdapter,
    private readonly orderAdapter: MercadoLivreOrderAdapter,
    public readonly categoryAdapter: MercadoLivreCategoryAdapter,
    private readonly http: MlHttpClient,
  ) {
    super();
  }

  private ctx(context: string, accountId?: string): HttpAuthContext {
    return { context, accountId };
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

  // Category methods (token/refresh ficam no MlHttpClient dentro do categoryAdapter)
  async getCategories(parentId?: string): Promise<any[]> {
    return this.categoryAdapter.getCategories(parentId);
  }

  // Métodos adicionais para categorias
  async getAllChildCategories(parentId: string): Promise<any[]> {
    return this.categoryAdapter.getAllChildCategories(parentId);
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

  async getCategoryDetails(categoryId: string): Promise<any> {
    return this.categoryAdapter.getCategoryDetails(categoryId);
  }

  async getShippingPreferences(categoryId: string): Promise<any> {
    return this.categoryAdapter.getShippingPreferences(categoryId);
  }

  async discoverCategory(title: string): Promise<any> {
    // Delega ao categoryAdapter (token/refresh/retry no MlHttpClient).
    return this.categoryAdapter.discoverCategory(title);
  }

  // Q&A Methods — token/refresh/retry no MlHttpClient (conta via accountId).
  async answerQuestion(questionId: string, text: string, accountId?: string): Promise<any> {
    try {
      return await this.http.post<any>(
        '/answers',
        this.ctx('answerQuestion', accountId),
        { question_id: Number(questionId), text },
      );
    } catch (error: any) {
      this.logger.error(`Erro ao responder pergunta ${questionId}: ${error.message}`);
      throw error;
    }
  }

  async getQuestionById(questionId: string, accountId?: string): Promise<any> {
    try {
      return await this.http.get<any>(`/questions/${questionId}`, this.ctx('getQuestionById', accountId));
    } catch (error: any) {
      this.logger.error(`Erro ao buscar pergunta ${questionId}: ${error.message}`);
      throw error;
    }
  }

  /** Delta poll: newest-first questions, stopping once we pass `since`. Returns refs for the reconciler. */
  async listQuestionsSince(
    sellerId: string,
    since: Date,
    accountId?: string,
  ): Promise<Array<{ id: string; item_id: string; status: string; date_created: string }>> {
    const limit = 50;
    const HARD_CAP = 500; // safety bound
    const ctx = this.ctx('listQuestionsSince', accountId);
    const out: Array<{ id: string; item_id: string; status: string; date_created: string }> = [];
    let offset = 0;

    try {
      while (offset < HARD_CAP) {
        const data = await this.http.get<any>(
          `/questions/search?seller_id=${sellerId}&sort_fields=item_id,date_created&api_version=4`,
          ctx,
          { sort: 'date_created_desc', limit, offset },
        );
        const page = data.questions || [];
        if (page.length === 0) break;

        let crossedCursor = false;
        for (const q of page) {
          if (new Date(q.date_created) <= since) { crossedCursor = true; break; }
          out.push({ id: String(q.id), item_id: q.item_id, status: q.status, date_created: q.date_created });
        }
        if (crossedCursor || page.length < limit) break;
        offset += limit;
      }
      this.logger.log(`[Reconcile] ${out.length} ML questions newer than ${since.toISOString()}`);
      return out;
    } catch (error: any) {
      this.logger.error(`Erro ao listar perguntas (delta): ${error.message}`);
      throw error;
    }
  }
}
