import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { CategoryQueryService, CategorySyncService, CategoryMappingService } from './category';
import { ProductService } from '../../product/product.service';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { MercadoLivreAdapter } from '../adapters/mercado-livre/mercado-livre.adapter';
import { CategorySuggestionService } from './category-suggestion.service';

import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from './marketplace-registry.service'; // For name resolution
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    private categoryQueryService: CategoryQueryService,
    private categorySyncService: CategorySyncService,
    private categoryMappingService: CategoryMappingService,
    @Inject(forwardRef(() => ProductService)) private productService: ProductService,
    private marketplaceAuthService: MarketplaceAuthService,
    private mercadoLivreAdapter: MercadoLivreAdapter,
    private categorySuggestionService: CategorySuggestionService,
    private adapterRegistry: MarketplaceAdapterRegistry,
    private registryService: MarketplaceRegistryService
  ) { }

  // Métodos de consulta delegados para CategoryQueryService
  async findCategories(marketplaceId: number | string, parentId?: string, query?: string) {
    return this.categoryQueryService.findCategories(marketplaceId, parentId, query);
  }

  async findCategoryByExternalId(marketplaceId: number | string, externalId: string) {
    return this.categoryQueryService.findCategoryByExternalId(marketplaceId, externalId);
  }

  async findCategoryById(id: number | string) {
    return this.categoryQueryService.findCategoryById(String(id));
  }

  // Método de sincronização delegado para CategorySyncService
  async syncCategories(marketplaceId: number | string, parentId?: string) {
    return this.categorySyncService.syncCategories(marketplaceId as any, parentId);
  }

  // Métodos de mapeamento delegados para CategoryMappingService
  async createMapping(
    marketplaceCategoryId: number | string,
    internalCategoryId: string,
    internalCategoryName: string,
    internalCategoryPath?: string,
    attributeMappings?: Record<string, any>,
    externalId?: string,
    externalName?: string,
  ) {
    return this.categoryMappingService.createMapping(
      marketplaceCategoryId,
      internalCategoryId,
      internalCategoryName,
      internalCategoryPath,
      attributeMappings,
      externalId,
      externalName,
    );
  }

  async updateMapping(
    id: number | string,
    marketplaceCategoryId?: number | string,
    internalCategoryName?: string,
    internalCategoryPath?: string,
    attributeMappings?: Record<string, any>,
    externalId?: string,
    externalName?: string,
  ) {
    return this.categoryMappingService.updateMapping(
      id as any,
      marketplaceCategoryId,
      internalCategoryName,
      internalCategoryPath,
      attributeMappings,
      externalId,
      externalName,
    );
  }

  async deleteMapping(id: number | string) {
    return this.categoryMappingService.deleteMapping(id as any);
  }

  async findMappingsByInternalCategory(internalCategoryId: string) {
    return this.categoryMappingService.findMappingsByInternalCategory(internalCategoryId);
  }

  async findMappingByInternalCategoryAndMarketplace(
    internalCategoryId: string,
    marketplaceId: number | string,
  ) {
    return this.categoryMappingService.findMappingByInternalCategoryAndMarketplace(
      internalCategoryId,
      marketplaceId,
    );
  }

  async findMappingById(id: number | string) {
    return this.categoryMappingService.findMappingById(id as any);
  }

  async findMappingsByMarketplace(marketplaceId: number | string) {
    return this.categoryMappingService.findMappingsByMarketplace(marketplaceId);
  }

  async findMappingsByMarketplaceCategory(marketplaceCategoryId: number | string) {
    return this.categoryMappingService.findMappingsByMarketplaceCategory(marketplaceCategoryId);
  }

  async suggestAndMapCategory(productId: string | number, marketplaceId: number | string): Promise<any> {
    return this.categorySuggestionService.suggestAndMapCategory(String(productId), marketplaceId as any);
  }

  async getShippingPreferences(marketplaceId: number | string, categoryId: string): Promise<any> {
    try {
      // TODO: Refactor to usage pattern found in other methods or use strategy pattern if multiple marketplaces support this.
      // For now, hardcoding to Mercado Livre flow as it's the requested feature.
      const token = await this.marketplaceAuthService.ensureValidToken(marketplaceId as any);
      if (!token || !token.accessToken) {
        throw new Error('Token de acesso não encontrado');
      }
      return this.mercadoLivreAdapter.getShippingPreferences(token.accessToken, categoryId);
    } catch (error) {
      this.logger.error(`Erro ao buscar preferências de envio: ${error.message}`);
      throw error;
    }
  }

  async getMarketplaceName(marketplaceId: string): Promise<string> {
    return this.registryService.getMarketplaceName(marketplaceId);
  }

  async domainDiscovery(marketplaceId: string, title: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    const adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);
    if (adapter && adapter.domainDiscovery) {
      return adapter.domainDiscovery(title);
    }
    throw new BadRequestException(`Descoberta de domínio não implementada para ${marketplaceName}.`);
  }

  async getCategory(marketplaceId: string, categoryId: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    const adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);
    if (adapter && adapter.getCategory) {
      return adapter.getCategory(categoryId);
    }
    throw new BadRequestException(`Descoberta de categoria não implementada para ${marketplaceName}.`);
  }

  async getCategoryAttributes(marketplaceId: string, categoryId: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    let adapter;
    try {
      adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);
    } catch (error) {
      this.logger.debug(`Skipping marketplace ${marketplaceName} for getCategoryAttributes: ${error.message}`);
      throw new BadRequestException(`Adaptador de categoria não encontrado ou inválido para ${marketplaceName}.`);
    }

    if (adapter && adapter.getCategoryAttributes) {
      try {
        return await adapter.getCategoryAttributes(categoryId);
      } catch (error) {
        this.logger.warn(`Failed to get attributes for category ${categoryId} on ${marketplaceName}: ${error.message}`);
        return [];
      }
    }
    // Instead of throwing BadRequest, return empty if not supported? 
    // Or throw if really not implemented? User wants to avoid API errors. 
    // Returning empty is safer for UI logic waiting for arrays.
    return [];
  }

  async getCategoryAttributesWithValues(marketplaceId: string, productId: number, categoryId: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    const adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);
    if (adapter && adapter.getCategoryAttributesWithValues) {
      return adapter.getCategoryAttributesWithValues(categoryId, productId);
    }
    throw new BadRequestException(`Descoberta de atributos de categoria com valores não implementada para ${marketplaceName}.`);
  }

  async getDomainWithCategories(marketplaceId: string, title: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    const adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);

    if (adapter && adapter.getDomainAndCategories) {
      const results = await adapter.getDomainAndCategories(title);

      // Persist results asynchronously
      if (Array.isArray(results)) {
        results.forEach(item => {
          if (item.category) {
            this.categorySyncService.saveDiscoveredCategory(marketplaceId, item.category)
              .catch(err => this.logger.warn(`Failed to persist discovered category ${item.category.id}`, err));
          }
        });
      }
      return results;
    }
    throw new BadRequestException(`Descoberta de domínio com categorias não implementada para ${marketplaceName}.`);
  }

  async getDomainWithCategoryAndAttributes(marketplaceId: string, title: string): Promise<any> {
    const marketplaceName = await this.getMarketplaceName(marketplaceId);
    const adapter = this.adapterRegistry.getCategoryAdapter(marketplaceName);
    if (adapter && adapter.getDomainWithCategoryAndAttributes) {
      return adapter.getDomainWithCategoryAndAttributes(title);
    }
    throw new BadRequestException(`Descoberta de domínio com categoria e atributos não implementada para ${marketplaceName}.`);
  }
}
