import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { OLXAuthService } from './olx-auth.service';
import { ProductDocument } from '../../../product/product-types';

@Injectable()
export class OLXImportService {
  private readonly logger = new Logger(OLXImportService.name);
  private readonly baseUrl = 'https://apps.olx.com.br';
  private readonly name = 'OLX';

  constructor(
    private readonly httpService: HttpService,
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly olxAuthService: OLXAuthService,
  ) { }

  /**
   * Importar anúncio na OLX
   * @param product - Dados do produto (token será obtido automaticamente)
   */
  async importAd(product: any): Promise<any> {
    try {
      // Validar dados obrigatórios
      if (!product || !product.sku) {
        throw new Error('Dados do produto inválidos ou incompletos');
      }

      const olxProduct = await this.transformProductToOLX(product, product.externalId);

      const token = await this.olxAuthService.getValidToken(this.name);
      if (!token) {
        throw new Error(`Token de acesso não encontrado para ${this.name}`);
      }

      // Token será adicionado automaticamente pelo interceptor HTTP
      const requestBody = {
        access_token: token.accessToken,
        ...olxProduct
      };



      // CORREÇÃO: Usar POST em vez de PUT para criar anúncios
      const response = await firstValueFrom(
        this.httpService.put(`${this.baseUrl}/autoupload/import`, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
          }
        })
      );



      // Validar resposta da API
      if (!response.data) {
        throw new Error('Resposta vazia da API OLX');
      }

      // Verificar se há erro na resposta
      if (response.data.statusCode && response.data.statusCode !== 0) {
        const errorMessage = response.data.statusMessage || 'Erro desconhecido da API OLX';
        const errors = response.data.errors || [];

        this.logger.error(`API OLX retornou erro: ${errorMessage}`, errors);
        throw new Error(`Falha na API OLX: ${errorMessage}`);
      }

      // Verificar se há dados de sucesso
      if (!response.data.id && !response.data.import_id) {
        throw new Error('API OLX não retornou ID do anúncio ou importação');
      }

      this.logger.log(`Anúncio importado com sucesso no ${this.name}`);

      return {
        marketplace: this.name,
        success: response.data.statusCode >= 0,
        adId: response.data.id,
        importId: response.data.import_id,
        status: response.data.status || response.data.statusMessage,
        message: 'Anúncio importado com sucesso',
        requestPayload: requestBody,
        responsePayload: response.data
      };
    } catch (error) {
      this.logger.error(`Erro ao importar anúncio no ${this.name}:`, error);

      // Retornar erro estruturado em vez de throw
      return {
        marketplace: this.name,
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Deletar anúncio da OLX
   * @param adId - ID do anúncio (token será obtido automaticamente)
   */
  async deleteAd(adId: string): Promise<any> {
    try {
      this.logger.log(`Deletando anúncio ${adId} no ${this.name}`);

      // Token será adicionado automaticamente pelo interceptor HTTP
      const response = await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/api/ads/${adId}`, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Anúncio ${adId} deletado com sucesso no ${this.name}`);

      return {
        marketplace: this.name,
        success: true,
        adId: adId,
        message: 'Anúncio deletado com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao deletar anúncio ${adId} no ${this.name}:`, error);
      throw new Error(`Falha ao deletar anúncio no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar status de importação
   * @param importId - ID da importação (token será obtido automaticamente)
   */
  async getImportStatus(importId: string): Promise<any> {
    try {
      this.logger.log(`Consultando status de importação ${importId} no ${this.name}`);

      // Token será adicionado automaticamente pelo interceptor HTTP
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/imports/${importId}/status`, {}, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Status de importação ${importId} consultado com sucesso no ${this.name}`);

      return {
        marketplace: this.name,
        success: true,
        importId: importId,
        status: response.data.status,
        progress: response.data.progress,
        message: response.data.message
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar status de importação ${importId} no ${this.name}:`, error);
      throw new Error(`Falha ao consultar status de importação no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar anúncios publicados
   * @param params - Parâmetros de consulta (token será obtido automaticamente)
   */
  async getPublishedAds(params: any = {}): Promise<any> {
    try {
      this.logger.log(`Consultando anúncios publicados no ${this.name}`);

      // Token será adicionado automaticamente pelo interceptor HTTP
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/autoupload/published`, params, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Anúncios publicados consultados com sucesso no ${this.name}`);

      return {
        marketplace: this.name,
        success: true,
        ads: response.data.ads,
        pagination: response.data.pagination,
        total: response.data.total
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar anúncios publicados no ${this.name}:`, error);
      throw new Error(`Falha ao consultar anúncios publicados no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Transformar produto para formato OLX usando templates de descrição
   * @param product - Produto do sistema
   * @param externalId - ID externo do anúncio (se for atualização)
   */
  private async transformProductToOLX(product: any, externalId?: string): Promise<any> {
    try {
      // Gerar descrição usando template da OLX
      const description = await this.descriptionService.generateDescription(product, 'OLX');

      return {
        ad_list: [{
          id: externalId || `SKU_${product.sku}`,
          operation: externalId ? 'update' : 'insert',
          category: 2101,
          subject: product.titles?.[0]?.title || product.name,
          body: description,
          params: {
            condition: '1'
          },
          phone: 81996518865,
          type: 's',
          price: (product as any).price || (product as any).costPrice,
          zipcode: '50720110',
          phone_hidden: true,
          images: product.images?.map(img => img.url) || [],
        }]
      };
    } catch (error) {
      this.logger.warn(`Erro ao gerar descrição usando template, usando descrição padrão: ${error.message}`);

      // Fallback para descrição padrão se o template falhar
      return {
        ad_list: [{
          id: externalId || product.sku,
          operation: externalId ? 'update' : 'insert',
          category: 2101,
          subject: product.titles?.[0]?.title || product.name,
          body: `${product.description || product.name}`,
          phone: 81996518865,
          type: 's',
          price: (product as any).price,
          zipcode: '50720110',
          phone_hidden: true,
          images: product.images?.map(img => img.url) || [],
        }]
      };
    }
  }

  /**
   * Mapear categoria para ID da OLX
   * @param category - Categoria do produto
   */
  private mapCategoryToOLX(category: any): string {
    // Mapeamento de categorias do sistema para IDs da OLX
    const categoryMapping = {
      'Paralamas': 'auto-parts',
      'Faróis': 'auto-parts',
      'Retrovisores': 'auto-parts',
      'Para-choques': 'auto-parts',
      'Capôs': 'auto-parts',
      'Portas': 'auto-parts',
      'Vidros': 'auto-parts',
      'Suspensão': 'auto-parts',
      'Freios': 'auto-parts',
      'Motor': 'auto-parts',
      'Transmissão': 'auto-parts',
      'Elétrica': 'auto-parts',
      'Acessórios': 'auto-parts'
    };

    const categoryName = typeof category === 'object' ? category.name : category;
    return categoryMapping[categoryName] || 'auto-parts';
  }

  /**
   * Extrair atributos do produto
   * @param product - Produto do sistema
   */
  private extractAttributes(product: any): any[] {
    const attributes = [];

    if (product.brand?.name) {
      attributes.push({
        name: 'Marca',
        value: product.brand.name
      });
    }

    if (product.partNumber) {
      attributes.push({
        name: 'Código',
        value: product.partNumber
      });
    }

    if (product.compatibilityKeywords) {
      attributes.push({
        name: 'Compatibilidade',
        value: product.compatibilityKeywords
      });
    }

    return attributes;
  }
}