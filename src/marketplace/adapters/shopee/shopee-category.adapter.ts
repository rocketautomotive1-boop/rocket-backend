import { Injectable, Logger } from '@nestjs/common';
import { ShopeeHttpClient } from './shopee-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';

@Injectable()
export class ShopeeCategoryAdapter {
  private readonly logger = new Logger(ShopeeCategoryAdapter.name);

  constructor(private readonly http: ShopeeHttpClient) {}

  /** Contexto de auth (conta default Shopee; token/shopId resolvidos pelo HttpClient). */
  private ctx(context: string): HttpAuthContext {
    return { context };
  }

  async getCategories(parentId?: string): Promise<any[]> {
    this.logger.log(`Buscando categorias da Shopee${parentId ? ` para categoria pai ${parentId}` : ''}`);

    try {
      const query = parentId ? { parent_id: parseInt(parentId) } : undefined;
      const payload = await this.http.get<any>('/product/get_category', this.ctx('getCategories'), query);

      const categoryList = payload?.response?.category_list ?? payload?.category_list ?? payload?.data?.category_list ?? [];
      if (!Array.isArray(categoryList)) {
        const previewKeys = Object.keys(payload || {});
        this.logger.error(`Resposta inesperada na busca de categorias. keys=${previewKeys.join(',')}`);
        throw new Error('Formato de resposta inesperado da Shopee para categorias');
      }
      this.logger.log(`${categoryList.length} categorias encontradas na Shopee`);
      return categoryList;
    } catch (error: any) {
      this.logger.error(`Erro na busca de categorias da Shopee: ${error.message}`, error.stack);
      if (error?.response?.status) {
        throw new Error(JSON.stringify(error.response.data));
      }
      throw error;
    }
  }
}
