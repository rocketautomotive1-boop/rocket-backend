import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { getShopeeBaseUrl } from './shopee-utils'
import { MarketplaceSignerService } from '../../auth/services/marketplace-signer.service';

@Injectable()
export class ShopeeCategoryAdapter {
  private readonly logger = new Logger(ShopeeCategoryAdapter.name);
  private baseUrl = getShopeeBaseUrl();

  constructor(private readonly signer: MarketplaceSignerService) {}

  async getCategories(accessToken: string, shopId: string, parentId?: string): Promise<any[]> {
    this.logger.log(`Buscando categorias da Shopee${parentId ? ` para categoria pai ${parentId}` : ''}`);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/get_category';
      const { params } = await this.signer.sign('shopee', { path, timestamp, accessToken, shopId });
      if (parentId) params.parent_id = parseInt(parentId);
      
      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: {
          'Content-Type': 'application/json',
        },
        params,
      });
      const payload = response.data || {}
      const categoryList = payload.response?.category_list ?? payload.category_list ?? payload.data?.category_list ?? []
      if (!Array.isArray(categoryList)) {
        const previewKeys = Object.keys(payload)
        this.logger.error(`Resposta inesperada na busca de categorias. keys=${previewKeys.join(',')}`)
        throw new Error('Formato de resposta inesperado da Shopee para categorias')
      }
      this.logger.log(`${categoryList.length} categorias encontradas na Shopee`);
      return categoryList;
    } catch (error: any) {
      this.logger.error(`Erro na busca de categorias da Shopee: ${error.message}`, error.stack);
      if (error?.response?.status) {
        throw new Error(JSON.stringify(error.response.data))
      }
      throw new Error(`Falha na busca de categorias da Shopee: ${error.message}`);
    }
  }
  
  
}
