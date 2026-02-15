import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { ProductDocument } from '../../product/product-types';
import { ProductTitle } from '../../product/product-types';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceDescriptionService } from './marketplace-description.service';
import { CategoryMappingService } from './category/category-mapping.service';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { ListingService } from '../../listing/listing.service'; // [NEW]
import { ListingDocument } from '../../listing/schemas/listing.schema'; // [NEW]

@Injectable()
export class MarketplaceIntegrationHelperService {
  private readonly logger = new Logger(MarketplaceIntegrationHelperService.name);

  constructor(
    @Inject(forwardRef(() => MarketplaceAuthService))
    private readonly marketplaceAuthService: MarketplaceAuthService,
    private readonly marketplaceRegistry: MarketplaceRegistryService,

    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly descriptionService: MarketplaceDescriptionService,
    @Inject(forwardRef(() => CategoryMappingService))
    private readonly categoryMappingService: CategoryMappingService,
    private readonly listingService: ListingService, // [NEW]
  ) { }

  /**
   * Valida o token de acesso para o marketplace
   */
  async validateToken(marketplace: MarketplaceDocument): Promise<void> {
    this.logger.log(`Validando token para marketplace ${marketplace.name}`);
    await this.marketplaceAuthService.ensureValidToken(marketplace._id);
  }

  /**
   * Obtém os títulos para um marketplace específico ou títulos genéricos
   */
  /**
   * Obtém os títulos para um marketplace específico ou títulos genéricos
   */
  async getTitlesForMarketplace(product: ProductDocument, marketplace: MarketplaceDocument): Promise<ListingDocument[]> {
    // [REF] Fetch listings from service
    const allListings = await this.listingService.findByProduct(product._id);

    if (!allListings || allListings.length === 0) {
      this.logger.log(`Produto ID ${product.id} não possui listings`);
      return [];
    }

    // Filtrar títulos específicos para este marketplace usando marketplaceId
    const marketplaceTitles = allListings.filter(
      l => String(l.marketplaceId) === String(marketplace._id)
    );

    // Se não houver títulos específicos, usar títulos genéricos (sem marketplaceId)?
    // Listing model always has marketplaceId required? Actually Schema says @Prop() marketplaceId.
    // Assuming if legacy code allowed generics, we check for missing marketplaceId.
    if (marketplaceTitles.length === 0) {
      // Logic for fallback?
      // Legacy: return product.titles.filter(title => !title.marketplaceId);
      // Listings usually must belong to a marketplace.
      // If no listing found for this marketplace, return empty or all?
      // Return empty to be safe.
      return [];
    }

    return marketplaceTitles;
  }

  /**
   * Atualiza o externalId de um título
   */
  async updateTitleExternalId(title: ProductTitle, externalId: string): Promise<any> {
    this.logger.warn(`updateTitleExternalId called for title, but ID-based repository lookup is disabled. ExternalId: ${externalId}`);
    title.externalId = externalId;
    return title;
  }

  /**
   * Salva o externalId em um título
   */
  async saveTitleExternalId(
    title: ProductTitle,
    externalId: string,
    productId: string | number,
    marketplaceName?: string
  ): Promise<void> {
    this.logger.warn(`saveTitleExternalId called for title, but repository saving is temporarily disabled. ExternalId: ${externalId}`);
    title.externalId = externalId;
  }

  /**
   * Trata erros de integração
   */
  handleError(error: any, marketplace: MarketplaceDocument, operation: string): any {
    this.logger.error(`Erro na operação ${operation} para marketplace ${marketplace.name}: ${error.message}`);

    // Extrair o response bruto do erro, se disponível
    const errorResponse = error.response?.data || error.marketplaceData || error.response || error.rawResponse || error.apiResponse || {};

    return {
      success: false,
      error: error.message,
      marketplace: marketplace.name,
      operation,
      timestamp: new Date().toISOString(),
      // Incluir o response bruto do marketplace
      marketplaceData: errorResponse,
      response: errorResponse,
      apiResponse: errorResponse,
      statusCode: error.statusCode || error.response?.status || 500
    };
  }

  /**
   * Cria um produto em um marketplace genérico (não implementado)
   */
  async createProductGeneric(product: ProductDocument, marketplace: MarketplaceDocument): Promise<any> {
    this.logger.warn(`Criação de produto para marketplace ${marketplace.name} não implementada`);

    return {
      success: false,
      error: `Integração com ${marketplace.name} não implementada para criação de produtos`,
      marketplace: marketplace.name,
      operation: 'create',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Atualiza um produto em um marketplace genérico (não implementado)
   */
  async updateProductGeneric(
    product: ProductDocument,
    marketplace: MarketplaceDocument
  ): Promise<any> {
    this.logger.warn(`Atualização de produto para marketplace ${marketplace.name} não implementada`);

    return {
      success: false,
      error: `Integração com ${marketplace.name} não implementada para atualização de produtos`,
      marketplace: marketplace.name,
      operation: 'update',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Gera a descrição formatada para um produto em um marketplace específico
   */
  async getFormattedDescription(product: ProductDocument, marketplaceId: number | string | any, templateId?: number): Promise<string> {
    try {
      const marketplace = await this.marketplaceRegistry.findOne(marketplaceId)
      const marketplaceName = marketplace?.name || ''
      return await this.descriptionService.generateDescription(product, marketplaceName, templateId ? String(templateId) : undefined);
    } catch (error) {
      this.logger.error(`Erro ao gerar descrição para produto ID ${product.id}: ${error.message}`);
      // Fallback para descrição básica
      return this.generateBasicDescription(product);
    }
  }

  /**
   * Gera uma descrição básica para fallback
   */
  private generateBasicDescription(product: ProductDocument): string {
    const parts = [];

    if (product.name) {
      parts.push(`Produto: ${product.name}`);
    }

    if (product.brand?.name || product.brand?.amazonName) {
      parts.push(`Marca: ${product.brand.amazonName || product.brand.name}`);
    }

    if (product.partNumber) {
      parts.push(`Modelo: ${product.partNumber}`);
    }

    if (product.description) {
      parts.push(`\nDescrição:\n${product.description}`);
    }

    // if (product.warranty?.description) {
    //   parts.push(`\nGarantia: ${product.warranty.description}`);
    // }

    // Adicionar dimensões se disponíveis
    const dimensions = [];
    if (product.weight) dimensions.push(`Peso: ${product.weight}kg`);
    if (product.dimensions?.length) dimensions.push(`Comprimento: ${product.dimensions.length}cm`);
    if (product.dimensions?.width) dimensions.push(`Largura: ${product.dimensions.width}cm`);
    if (product.dimensions?.height) dimensions.push(`Altura: ${product.dimensions.height}cm`);

    if (dimensions.length > 0) {
      parts.push(`\nDimensões:\n${dimensions.join('\n')}`);
    }

    return parts.join('\n');
  }

  /**
   * Obtém a categoria do marketplace mapeada para um produto
   */
  async getMarketplaceCategoryForProduct(product: ProductDocument, marketplaceId: number | string | any): Promise<string | null> {
    const categoryId = (product.category as any)?._id || (product.category as any)?.id || product.category;

    if (!categoryId) {
      this.logger.warn(`Produto ID ${product.id} não possui categoria`);
      return null;
    }

    try {
      const marketplaceCategory = await this.categoryMappingService.getMarketplaceCategoryForProduct(
        categoryId,
        marketplaceId
      );

      return marketplaceCategory?.externalId || null;
    } catch (error) {
      this.logger.error(`Erro ao obter categoria para produto ID ${product.id}: ${error.message}`);
      return null;
    }
  }

  generateEAN13(): string {
    const prefix = '789';
    let body = '';
    for (let i = 0; i < 9; i++) {
      body += Math.floor(Math.random() * 10).toString();
    }
    const base = prefix + body;

    // calculating the check digit
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const ean13 = prefix + body + checkDigit.toString();
    console.log(ean13);
    return ean13;
  }
}
