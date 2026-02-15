import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { MarketplaceService } from '../../services/marketplace.service';

import { OLXAuthService } from './olx-auth.service';
import { OLXImportService } from './olx-import.service';
import { OLXCatalogService } from './olx-catalog.service';
import { OLXHighlightsService } from './olx-highlights.service';
import { OLXWebhookService } from './olx-webhook.service';
import { ProductService } from '../../../product/product.service';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { ListingService } from '../../../listing/listing.service'; // [NEW] Import

@Injectable()
export class OLXProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  constructor(
    private readonly authService: OLXAuthService,
    private readonly importService: OLXImportService,
    private readonly catalogService: OLXCatalogService,
    private readonly highlightsService: OLXHighlightsService,
    private readonly webhookService: OLXWebhookService,
    @Inject(forwardRef(() => ProductService))
    private readonly productService: ProductService,
    @Inject(forwardRef(() => MarketplaceService))
    private readonly marketplaceService: MarketplaceService,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly listingService: ListingService, // [NEW] Inject
  ) { }


  private readonly logger = new Logger(OLXProductAdapter.name);
  private readonly name = 'OLX';

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
  }

  async getListings(params: any): Promise<any[]> {
    const mId = params.marketplaceId;
    const result = await this.getPublishedAds({
      offset: params?.offset || 0,
      limit: params?.limit || 50
    });
    const ads = result.ads || [];
    return ads.map((ad: any) => ({
      id: ad.ad_id || ad.list_id || String(ad.id),
      title: ad.subject || ad.title || 'Anúncio OLX',
      price: typeof ad.price === 'string' ? parseFloat(ad.price.replace(/\D/g, '')) / 100 : Number(ad.price || 0),
      available_quantity: 1,
      sold_quantity: 0,
      status: ad.status || 'active',
      thumbnail: ad.images?.[0]?.url || ad.image_url || '',
      permalink: ad.url || '',
      date_created: ad.date || new Date().toISOString(),
      marketplace: {
        id: mId,
        name: this.name,
        type: 'olx',
        icon: 'file-document-outline'
      }
    }));
  }

  /**
   * Verificar status dos tokens da OLX
   * @param marketplaceName - Nome do marketplace (opcional, usa 'OLX' por padrão)
   */
  async checkTokenStatus(marketplaceName: string = 'OLX'): Promise<any> {
    return await this.authService.checkTokenStatus(marketplaceName);
  }

  /**
   * Realizar autenticação automática na OLX
   */
  async performAutoAuthentication(): Promise<any> {
    this.logger.log(`Iniciando autenticação automática para OLX`);

    try {
      // Buscar marketplace OLX
      const marketplace = await this.marketplaceService.findByName('OLX');

      if (!marketplace) {
        throw new Error('Marketplace OLX não encontrado');
      }

      // Realizar autenticação automática
      const newToken = await this.authService.performAutomaticAuthentication(marketplace);

      this.logger.log(`Autenticação automática para OLX realizada com sucesso`);

      return {
        marketplace: 'OLX',
        success: true,
        message: 'Autenticação automática realizada com sucesso',
        token: {
          id: (newToken as any).id || (newToken as any)._id,
          expiresAt: newToken.expiresAt,
          isActive: newToken.isActive
        }
      };
    } catch (error) {
      this.logger.error(`Erro na autenticação automática para OLX: ${error.message}`);
      throw error;
    }
  }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    const productId = product.id;

    try {
      const results = [];
      // [REF] Fetch listings from service
      const allListings = await this.listingService.findByProduct(product._id);

      const titles = allListings.filter(t =>
        String(t.marketplaceId) === String(marketplace.id) ||
        ((marketplace as any).mongoId && String(t.marketplaceId) === String((marketplace as any).mongoId))
      );

      if (titles.length === 0) {
        titles.push({ title: product.name } as any);
      }

      for (const title of titles) {
        try {
          const finalExternalId = externalId || title.externalId;

          // OLX uses a single method for both create and update
          // We pass the externalId to the service to handle the operation type
          const result = await this.importService.importAd({
            ...product,
            externalId: finalExternalId,
            titles: [title] // Use the specific title
          });

          results.push(result);
        } catch (error: any) {
          this.logger.error(`Erro ao processar título ${title.title}:`, error.response?.data || error.message);
          results.push({
            success: false,
            error: error.message,
            title: title.title,
            requestPayload: { ...product, externalId: externalId || title.externalId, titles: [title] },
            responsePayload: error.response?.data || null
          });
        }
      }

      const success = results.some(r => r.success);
      const firstSuccess = results.find(r => r.success);

      return {
        success,
        externalId: firstSuccess?.externalId || firstSuccess?.adId,
        results,
        result: results,
        error: success ? undefined : results[0]?.error,
        responsePayload: results.length === 1 ? results[0].responsePayload : results,
        requestPayload: results.length === 1 ? results[0].requestPayload : results.map(r => r.requestPayload)
      };
    } catch (error: any) {
      this.logger.error('Erro ao publicar produto na OLX:', error);
      return {
        success: false,
        error: error.message,
        requestPayload: null,
        responsePayload: error.response?.data || null
      };
    }
  }

  async createProduct(product: any): Promise<any> {
    // Alias to publish logic
    return this.importService.importAd({ ...product, externalId: undefined });
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    // Alias to publish logic
    return this.importService.importAd({ ...product, externalId });
  }

  /**
   * Autenticar com OLX
   * @param clientId - ID do cliente
   * @param clientSecret - Secret do cliente
   * @param redirectUri - URI de redirecionamento
   * @param code - Código de autorização
   */
  async authenticate(code: string): Promise<any> {
    return await this.authService.authenticate(code);
  }

  /**
   * Renovar token de acesso
   * @param clientId - ID do cliente
   * @param clientSecret - Secret do cliente
   * @param refreshToken - Token de renovação
   */
  async refreshToken(clientId: string, clientSecret: string, refreshToken: string): Promise<any> {
    return await this.authService.refreshToken({
      refreshToken,
      additionalData: { clientId, clientSecret }
    });
  }


  generateAuthUrl(): any {
    return this.authService.generateAuthUrl();
  }

  /**
   * Importar anúncio
   * @param product - Dados do produto (token será obtido automaticamente)
   */
  async importAd(product: any): Promise<any> {
    return await this.importService.importAd(product);
  }

  /**
   * Deletar anúncio
   * @param adId - ID do anúncio (token será obtido automaticamente)
   */
  async deleteAd(adId: string): Promise<any> {
    return await this.importService.deleteAd(adId);
  }

  /**
   * Consultar status de importação
   * @param importId - ID da importação (token será obtido automaticamente)
   */
  async getImportStatus(importId: string): Promise<any> {
    return await this.importService.getImportStatus(importId);
  }

  /**
   * Consultar anúncios publicados
   * @param params - Parâmetros de consulta (token será obtido automaticamente)
   */
  async getPublishedAds(params: any = {}): Promise<any> {
    return await this.importService.getPublishedAds(params);
  }

  /**
   * Consultar marcas de carros
   * @param accessToken - Token de acesso OAuth
   */
  async getCarBrands(accessToken: string): Promise<any> {
    return await this.catalogService.getCarBrands(accessToken);
  }

  /**
   * Consultar modelos de carros
   * @param accessToken - Token de acesso OAuth
   * @param brandId - ID da marca
   */
  async getCarModels(accessToken: string, brandId: string): Promise<any> {
    return await this.catalogService.getCarModels(accessToken, brandId);
  }

  /**
   * Consultar marcas de motos
   * @param accessToken - Token de acesso OAuth
   */
  async getMotorcycleBrands(accessToken: string): Promise<any> {
    return await this.catalogService.getMotorcycleBrands(accessToken);
  }

  /**
   * Consultar modelos de motos
   * @param accessToken - Token de acesso OAuth
   * @param brandId - ID da marca
   */
  async getMotorcycleModels(accessToken: string, brandId: string): Promise<any> {
    return await this.catalogService.getMotorcycleModels(accessToken, brandId);
  }

  /**
   * Consultar categorias
   * @param accessToken - Token de acesso OAuth
   */
  async getCategories(accessToken: string): Promise<any> {
    return await this.catalogService.getCategories(accessToken);
  }

  /**
   * Consultar subcategorias
   * @param accessToken - Token de acesso OAuth
   * @param categoryId - ID da categoria
   */
  async getSubcategories(accessToken: string, categoryId: string): Promise<any> {
    return await this.catalogService.getSubcategories(accessToken, categoryId);
  }

  /**
   * Consultar saldo
   * @param accessToken - Token de acesso OAuth
   */
  async getBalance(accessToken: string): Promise<any> {
    return await this.highlightsService.getBalance(accessToken);
  }

  /**
   * Aplicar destaque
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   * @param highlightType - Tipo de destaque
   */
  async applyHighlight(accessToken: string, adId: string, highlightType: string): Promise<any> {
    return await this.highlightsService.applyHighlight(accessToken, adId, highlightType);
  }

  /**
   * Remover destaque
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   * @param highlightId - ID do destaque
   */
  async removeHighlight(accessToken: string, adId: string, highlightId: string): Promise<any> {
    return await this.highlightsService.removeHighlight(accessToken, adId, highlightId);
  }

  /**
   * Consultar destaques de anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   */
  async getAdHighlights(accessToken: string, adId: string): Promise<any> {
    return await this.highlightsService.getAdHighlights(accessToken, adId);
  }

  /**
   * Consultar configurações de destaques
   * @param accessToken - Token de acesso OAuth
   */
  async getHighlightConfigurations(accessToken: string): Promise<any> {
    return await this.highlightsService.getHighlightConfigurations(accessToken);
  }

  /**
   * Renovar anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   */
  async renewAd(accessToken: string, adId: string): Promise<any> {
    return await this.highlightsService.renewAd(accessToken, adId);
  }

  /**
   * Configurar webhook
   * @param accessToken - Token de acesso OAuth
   * @param webhookUrl - URL do webhook
   * @param events - Eventos para monitorar
   */
  async configureWebhook(accessToken: string, webhookUrl: string, events: string[] = ['ad_status_changed']): Promise<any> {
    return await this.webhookService.configureWebhook(accessToken, webhookUrl, events);
  }

  /**
   * Listar webhooks
   * @param accessToken - Token de acesso OAuth
   */
  async listWebhooks(accessToken: string): Promise<any> {
    return await this.webhookService.listWebhooks(accessToken);
  }

  /**
   * Remover webhook
   * @param accessToken - Token de acesso OAuth
   * @param webhookId - ID do webhook
   */
  async removeWebhook(accessToken: string, webhookId: string): Promise<any> {
    return await this.webhookService.removeWebhook(accessToken, webhookId);
  }

  /**
   * Processar notificação de webhook
   * @param payload - Payload da notificação
   */
  async processWebhookNotification(payload: any): Promise<any> {
    return await this.webhookService.processWebhookNotification(payload);
  }
}
