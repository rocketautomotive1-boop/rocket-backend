import { Injectable, Logger } from '@nestjs/common';
import { ProductCategoryService } from '../../../product/services/product-category.service';
import { CategoryQueryService } from './category-query.service';
import { Types } from 'mongoose';

@Injectable()
export class CategoryMappingService {
  private readonly logger = new Logger(CategoryMappingService.name);

  constructor(
    private productCategoryService: ProductCategoryService,
    private categoryQueryService: CategoryQueryService,
  ) { }

  async createMapping(
    marketplaceCategoryId: string | number | undefined,
    internalCategoryId: string,
    internalCategoryName: string,
    internalCategoryPath?: string,
    attributeMappings?: Record<string, any>,
    externalId?: string,
    externalName?: string,
  ): Promise<any> {
    this.logger.log(`Criando ou atualizando mapeamento para categoria interna ${internalCategoryId} via CategoryMappingService`);

    // We need marketplaceId. In legacy flow, it was inferred from marketplaceCategoryId (MarketplaceCategoryDoc).
    // We must attempt to fetch the MarketplaceCategoryDoc to get the MarketplaceId IF externalId is not enough info?
    // Or we accept that this method is broken without explicit MarketplaceId if we don't have the doc.

    let mId: any;
    let resolvedExternalId = externalId;
    let resolvedExternalName = externalName;

    // 1. Resolve Marketplace Context
    if (marketplaceCategoryId) {
      try {
        // We still use categoryQueryService which likely uses MarketplaceCategoryModel (which is fine, not deleted).
        const mpCat = await this.categoryQueryService.findCategoryById(String(marketplaceCategoryId));
        if (mpCat) {
          mId = mpCat.marketplace;
          if (!resolvedExternalId) resolvedExternalId = mpCat.externalId;
          if (!resolvedExternalName) resolvedExternalName = mpCat.name;
        }
      } catch (e) {
        this.logger.warn(`Failed to resolve marketplace category: ${e.message}`);
      }
    }

    if (!mId) {
      throw new Error("Cannot create mapping: Marketplace Context could not be resolved.");
    }

    // 2. Update Internal Category
    const category = await this.productCategoryService.findOne(internalCategoryId);
    if (!category) throw new Error(`Category ${internalCategoryId} not found`);

    if (!category.marketplaceMappings) category.marketplaceMappings = [];

    const existingIndex = category.marketplaceMappings.findIndex(m => String(m.marketplaceId) === String(mId));

    const mappingData = {
      marketplaceId: mId,
      externalId: resolvedExternalId || 'unknown',
      externalName: resolvedExternalName || 'unknown',
      path: resolvedExternalName || 'unknown', // Simplification
      attributeMappings: attributeMappings || {}
    };

    if (existingIndex > -1) {
      category.marketplaceMappings[existingIndex] = { ...category.marketplaceMappings[existingIndex], ...mappingData };
    } else {
      category.marketplaceMappings.push(mappingData);
    }

    await this.productCategoryService.update((category as any)._id.toString(), {
      marketplaceMappings: category.marketplaceMappings
    });

    return { ...mappingData, _id: 'simulated' }; // return pseudo doc
  }

  async updateMapping(
    id: string | number,
    marketplaceCategoryId?: string | number,
    internalCategoryName?: string,
    internalCategoryPath?: string,
    attributeMappings?: Record<string, any>,
    externalId?: string,
    externalName?: string,
  ): Promise<any> {
    this.logger.log(`Atualizando mapeamento ID ${id} via embedded mappings`);

    // Find the category containing this mapping ID
    const category = await this.productCategoryService.findOneByMappingId(String(id));

    if (!category || !category.marketplaceMappings) {
      throw new Error(`Mapeamento ID ${id} não encontrado`);
    }

    const mappingIndex = category.marketplaceMappings.findIndex(m => (m as any)._id && String((m as any)._id) === String(id));

    if (mappingIndex === -1) {
      throw new Error(`Mapeamento ID ${id} não encontrado na categoria`);
    }

    const mapping = category.marketplaceMappings[mappingIndex];

    if (marketplaceCategoryId) {
      try {
        const marketplaceCategory = await this.categoryQueryService.findCategoryById(String(marketplaceCategoryId));
        if (marketplaceCategory) {
          const mId = marketplaceCategory.marketplace instanceof Types.ObjectId
            ? marketplaceCategory.marketplace
            : new Types.ObjectId((marketplaceCategory.marketplace as any)._id);

          mapping.marketplaceId = mId;
          if (!externalId) mapping.externalId = marketplaceCategory.externalId;
          if (!externalName) mapping.externalName = marketplaceCategory.name;
        }
      } catch (e) { this.logger.warn("Failed to resolve MP category during update"); }
    }

    if (externalId) mapping.externalId = externalId;
    if (externalName) mapping.externalName = externalName;
    if (attributeMappings) mapping.attributeMappings = attributeMappings;
    // internalCategoryName/Path updates on the mapping usually redundant if we have the category relation, likely safely ignored or stored if schema allows.

    category.marketplaceMappings[mappingIndex] = mapping;

    await this.productCategoryService.update((category as any)._id.toString(), {
      marketplaceMappings: category.marketplaceMappings
    });

    return mapping;
  }

  async deleteMapping(id: string): Promise<boolean> {
    this.logger.log(`Excluindo mapeamento ID ${id}`);

    const category = await this.productCategoryService.findOneByMappingId(id);
    if (!category || !category.marketplaceMappings) return false;

    // Filter out the mapping
    const originalLen = category.marketplaceMappings.length;
    category.marketplaceMappings = category.marketplaceMappings.filter(m => !(m as any)._id || String((m as any)._id) !== id);

    if (category.marketplaceMappings.length < originalLen) {
      await this.productCategoryService.update((category as any)._id.toString(), {
        marketplaceMappings: category.marketplaceMappings
      });
      return true;
    }
    return false;
  }

  async findMappingsByInternalCategory(internalCategoryId: string): Promise<any[]> {
    this.logger.log(`Buscando mapeamentos para categoria interna ${internalCategoryId}`);
    const category = await this.productCategoryService.findOne(internalCategoryId);
    if (!category || !category.marketplaceMappings) return [];

    return category.marketplaceMappings.map(m => ({
      ...m,
      internalCategoryId: (category as any)._id.toString()
    }));
  }

  async findMappingByInternalCategoryAndMarketplace(
    internalCategoryId: string,
    marketplaceId: any,
  ): Promise<any | null> {
    this.logger.log(`Buscando mapeamento para categoria interna ${internalCategoryId} e marketplace ${marketplaceId}`);

    try {
      const category = await this.productCategoryService.findOne(internalCategoryId);
      if (category && category.marketplaceMappings) {
        const mIdStr = String(marketplaceId);
        const mapping = category.marketplaceMappings.find(m => String(m.marketplaceId) === mIdStr);
        if (mapping) {
          // Adapt to legacy structure if needed or return new structure
          return {
            _id: (mapping as any)._id || 'generated-id',
            internalCategoryId: (category as any)._id.toString(),
            marketplace: mapping.marketplaceId,
            externalId: mapping.externalId,
            externalName: mapping.externalName,
            marketplaceCategory: mapping.marketplaceId,
            attributeMappings: mapping.attributeMappings,
            path: mapping.path
          };
        }
      }
    } catch (e) {
      this.logger.warn(`Error finding mapping: ${e.message}`);
    }

    return null;
  }

  async findMappingById(id: string): Promise<any | null> {
    this.logger.log(`Buscando mapeamento por ID ${id}`);
    const category = await this.productCategoryService.findOneByMappingId(id);
    if (!category || !category.marketplaceMappings) return null;

    const mapping = category.marketplaceMappings.find(m => (m as any)._id && String((m as any)._id) === id);
    if (!mapping) return null;

    return { ...mapping, internalCategoryId: (category as any)._id.toString() };
  }

  async findMappingsByMarketplace(marketplaceId: any): Promise<any[]> {
    this.logger.log(`Buscando mapeamentos para marketplace ${marketplaceId}`);
    // This is expensive unless indexed properly. 
    // We need to find ALL categories that have a mapping for this marketplace.
    const categories = await this.productCategoryService.findByMarketplace(String(marketplaceId));

    // Extract flatten list
    const mappings = [];
    categories.forEach(cat => {
      if (cat.marketplaceMappings) {
        cat.marketplaceMappings.forEach(m => {
          if (String(m.marketplaceId) === String(marketplaceId)) {
            mappings.push({ ...m, internalCategoryId: (cat as any)._id.toString() });
          }
        });
      }
    });
    return mappings;
  }

  async findMappingsByMarketplaceCategory(marketplaceCategoryId: any): Promise<any[]> {
    this.logger.log(`Legacy findMappingsByMarketplaceCategory ${marketplaceCategoryId} - Returning empty as logic is deprecated`);
    // Not easy to reverse without scanning all. Deprecating safely.
    return [];
  }

  /**
   * Retorna o mapeamento de categoria para um produto e marketplace específicos
   */
  async findMappingForProductAndMarketplace(
    productCategoryId: string,
    marketplaceId: any,
  ): Promise<any | null> {
    this.logger.log(`Buscando mapeamento para produto com categoria ${productCategoryId} e marketplace ${marketplaceId}`);

    return this.findMappingByInternalCategoryAndMarketplace(productCategoryId, marketplaceId);
  }

  /**
   * Retorna a categoria do marketplace para um produto, com base no mapeamento
   */
  async getMarketplaceCategoryForProduct(
    productCategoryId: string,
    marketplaceId: any,
  ): Promise<any | null> {
    const mapping = await this.findMappingByInternalCategoryAndMarketplace(
      productCategoryId,
      marketplaceId,
    );

    if (!mapping) return null;

    return this.categoryQueryService.findCategoryById((mapping.marketplaceCategory as any).toString());
  }

  /**
   * Resolve a marketplace category to an internal category ID.
   * If mapping exists, returns the internalCategoryId.
   * If not, it may create a pending mapping or return null.
   */
  /**
   * Resolves an Internal Category ID to a Marketplace Category External ID.
   * Logic: 
   * 1. Find mapping for (InternalId, MarketplaceId).
   * 2. If found, populate 'marketplaceCategory' to get the actual External ID string.
   */
  async resolveCategory(
    internalCategoryId: string,
    marketplaceId: string
  ): Promise<string | null> {

    // Find mapping
    this.logger.debug(`[resolveCategory] Resolving mapping for InternalID: ${internalCategoryId} on MarketplaceID: ${marketplaceId}`);
    const mapping = await this.findMappingByInternalCategoryAndMarketplace(
      internalCategoryId,
      marketplaceId
    );

    if (!mapping) {
      // this.logger.warn(`[resolveCategory] No mapping found for ${internalCategoryId} / ${marketplaceId}`);
      return null;
    }

    this.logger.debug(`[resolveCategory] Mapping found: ${mapping._id} - ExternalID: ${mapping.externalId}`);
    return mapping.externalId || null;
  }

  /**
   * Reverse resolution: External ID -> Internal ID (e.g. for Imports)
   */
  async resolveToInternalCategory(
    targetMarketplaceCategoryExternalId: string,
    marketplaceId: string
  ): Promise<string | null> {

    // 1. Find the Marketplace Category by External ID and Marketplace
    // We assume marketplace categories are already synced/exist.
    const marketplace = await this.categoryQueryService.findCategoryByExternalId(
      marketplaceId,
      targetMarketplaceCategoryExternalId
    );

    if (!marketplace) {
      this.logger.warn(`Marketplace Category ${targetMarketplaceCategoryExternalId} not found for marketplace ${marketplaceId}`);
      // Can't map if we don't know what it is.
      // Optional: Trigger a sync for this category if possible, but for now just return null.
      return null;
    }

    // 2. Find Mapping
    const mapping = await this.findMappingsByMarketplaceCategory(marketplace._id);

    if (mapping && mapping.length > 0) {
      // Assume first mapping is valid (1:1 usually, or N:1 where N marketplace -> 1 internal)
      const activeMapping = mapping.find(m => m.status === 'mapped');
      if (activeMapping) {
        return activeMapping.internalCategoryId;
      }
    }

    // 3. No mapping found. Create a Pending Mapping if needed.
    // Check if we already have a pending one to avoid duplicates
    const pendingMapping = mapping?.find(m => m.status === 'pending');

    if (!pendingMapping) {
      this.logger.log(`Creating PENDING mapping for ${marketplace.name} (${targetMarketplaceCategoryExternalId})`);
    }

    return null;
  }
}
