import { Inject, forwardRef, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductDocument, ProductModel, ProductCategory, ProductAttribute } from '../../product/product-types';
import { MarketplaceCategoryModel, MarketplaceCategoryDocument } from '../schemas/marketplace-category.schema';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
// import { CategoryMappingModel, CategoryMappingDocument } from '../schemas/category-mapping.schema';
import { MercadoLivreAttributesService } from './mercado-livre-attributes.service';
import { CategoryAttribute as CategoryAttributeInterface } from '../interfaces/category-attribute.interface';
import { MercadoLivreCategoryAdapter } from '../adapters/mercado-livre/mercado-livre-category.adapter';
import { MercadoLivreAuthAdapter } from '../adapters/mercado-livre/mercado-livre-auth.adapter';

import { QueueService } from '../../queue/queue.service';
import { MarketplaceCategoryService } from './marketplace-category.service';
import { ProductCategoryService } from '../../product/services/product-category.service';
@Injectable()
export class ProductAttributesService {
  private readonly logger = new Logger(ProductAttributesService.name);

  constructor(
    @InjectModel(ProductModel.name)
    private productModel: Model<ProductDocument>,
    @InjectModel(MarketplaceCategoryModel.name)
    private marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,

    @Inject(forwardRef(() => MercadoLivreAttributesService))
    private mercadoLivreAttributesService: MercadoLivreAttributesService,
    @Inject(forwardRef(() => MercadoLivreCategoryAdapter))
    private mercadoLivreCategoryAdapter: MercadoLivreCategoryAdapter,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    private readonly marketplaceCategoryService: MarketplaceCategoryService,
    @Inject(forwardRef(() => ProductCategoryService))
    private readonly productCategoryService: ProductCategoryService,
  ) { }

  async saveProductAttributes(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    categoryId: string,
    attributes: Array<{ id: string; value: any; name?: string; valueName?: string; valueType?: string }>,
    dimensions?: { height: number; width: number; length: number; weight: number },
    explicitInternalCategoryId?: string
  ) {
    try {
      // 1. Find or Create/Update Marketplace Category (Delegated)
      const marketplaceCategory = await this.marketplaceCategoryService.ensureCategory(
        categoryId,
        marketplace,
        true // allowFetch
      );

      // 2. Handle Product Mapping / Category
      // 2. Handle Product Mapping / Category
      // FIX: If product already has a category, use it (don't overwrite with auto-generated tree)
      let internalCategoryId: string | null = null;

      if (explicitInternalCategoryId && Types.ObjectId.isValid(explicitInternalCategoryId)) {
        internalCategoryId = explicitInternalCategoryId;
      }

      if (!internalCategoryId && product.category) {
        // Use existing category
        internalCategoryId = (product.category as any)._id?.toString() || (product.category as any).toString();
        // Ensure it's a valid string ID
        if (internalCategoryId && !Types.ObjectId.isValid(internalCategoryId)) {
          internalCategoryId = null; // Reset if invalid
        }
      }

      // DISABLED: Auto-creation of categories from marketplace structure
      // This was polluting the categories collection with unwanted auto-generated categories
      // Users should explicitly select or create categories via the frontend
      /*
      if (!internalCategoryId) {
        // No internal category? Try to sync/mirror from Marketplace
        try {
          internalCategoryId = await this.marketplaceCategoryService.ensureInternalCategoryTree(marketplaceCategory);
          if (internalCategoryId) {
            product.category = new Types.ObjectId(internalCategoryId);
            this.logger.log(`Auto-assigned internal category ${internalCategoryId} to product ${product._id}`);
          }
        } catch (err) {
          this.logger.warn(`Failed to sync internal category tree: ${err.message}`);
        }
      }
      */

      // Fallback: Use CategoryMappingService to resolve category
      if (!product.category && categoryId) {
        try {
          // We need to find a category that has this marketplace mapping
          // internalCategoryId no longer needed in query, we search inside marketplaceMappings
          const resolvedCategory = await this.productCategoryService.findByMarketplaceMapping(marketplace._id.toString(), categoryId);
          if (resolvedCategory) {
            product.category = (resolvedCategory as any)._id;
          }
        } catch (e) {
          this.logger.warn(`Fallback mapping failed: ${e.message}`);
        }
      }

      // Fallback: If no tree synced, check if product already has a category
      if (!product.category && typeof product.category === 'object' && (product.category as any)._id) {
        product.category = (product.category as any)._id; // Fix legacy object structure if present
      }


      // Create or Update mapping in the internal category
      if (internalCategoryId && Types.ObjectId.isValid(internalCategoryId)) {
        try {
          const category = await this.productCategoryService.findOne(internalCategoryId);
          if (category) {
            // Ensure array exists
            if (!category.marketplaceMappings) category.marketplaceMappings = [];

            const existingIndex = category.marketplaceMappings.findIndex(m =>
              String(m.marketplaceId) === String(marketplace._id) &&
              m.externalId === categoryId
            );

            const mappingData = {
              marketplaceId: marketplace._id,
              externalId: categoryId,
              externalName: marketplaceCategory.name || 'Unknown',
              path: marketplaceCategory.path || 'Unknown',
              attributeMappings: {} // potentially update this if we have mapping logic
            };

            if (existingIndex > -1) {
              // Update existing
              category.marketplaceMappings[existingIndex] = {
                ...category.marketplaceMappings[existingIndex],
                ...mappingData
              };
            } else {
              // Add new
              category.marketplaceMappings.push(mappingData);
            }

            await this.productCategoryService.update((category as any)._id.toString(), {
              marketplaceMappings: category.marketplaceMappings
            } as any);
            this.logger.log(`Updated marketplace mapping for category ${category.name}`);
          }
        } catch (e) {
          this.logger.error(`Failed to update internal category mapping: ${e.message}`);
        }
      }


      // 3. Update Dimensions
      if (dimensions) {
        let hasUpdates = false;
        if (!product.weight && dimensions.weight > 0) {
          product.weight = dimensions.weight as any; // Decimal128 handling? casting to any for now
          hasUpdates = true;
        }
        if (!product.dimensions) product.dimensions = {} as any;

        if (!product.dimensions?.height && dimensions.height > 0) {
          product.dimensions.height = dimensions.height as any;
          hasUpdates = true;
        }
        if (!product.dimensions?.width && dimensions.width > 0) {
          product.dimensions.width = dimensions.width as any;
          hasUpdates = true;
        }
        if (!product.dimensions?.length && dimensions.length > 0) {
          product.dimensions.length = dimensions.length as any;
          hasUpdates = true;
        }

        if (hasUpdates) {
          this.logger.log(`Updating product dimensions from category defaults`);
        }
      }

      // 4. Update Attributes
      // Fetch definitions for names ONLY if names are missing in payload
      // Optimization: If all attributes have names, skip fetching definitions
      let categoryAttributesMap = new Map<string, CategoryAttributeInterface>();
      const missingNames = attributes.some(a => !a.name);

      if (missingNames && marketplace.name === 'Mercado Livre') {
        try {
          const categoryAttributes = await this.mercadoLivreCategoryAdapter.getCategoryAttributes(categoryId);
          categoryAttributesMap = new Map(categoryAttributes.map(attr => [attr.id, attr]));
        } catch (e) {
          this.logger.warn(`Failed to fetch attributes defs: ${e.message}`);
        }
      }

      this.logger.log(`[saveProductAttributes] Received attributes payload: ${JSON.stringify(attributes)}`);
      const validAttributes = attributes.filter(attr => attr.value !== null && attr.value !== undefined && String(attr.value).trim() !== '');

      // Build the new ML attributes list from the payload
      const newMlAttributes: ProductAttribute[] = validAttributes.map(attr => {
        const def = categoryAttributesMap.get(attr.id);
        const name = attr.name || def?.name || attr.id;
        const attrMarketplaceId = (attr as any).marketplaceId || marketplace._id;
        return {
          code: attr.id,
          value: String(attr.value),
          name,
          marketplaceId: attrMarketplaceId as any,
          valueName: (attr as any).valueName,
          valueType: (attr as any).valueType,
        } as ProductAttribute;
      });

      // Use findOneAndUpdate to atomically replace ML attributes for this marketplace.
      // Avoids Mongoose VersionError when saveCategory and saveMLAttributes run in close
      // succession and both try to call product.save() on the same __v snapshot.
      const existingDoc = await this.productModel.findById(product._id).lean().exec();
      const keptAttributes = (existingDoc?.attributes ?? []).filter(
        (a: any) => String(a.marketplaceId) !== String(marketplace._id),
      );
      const mergedAttributes = [...keptAttributes, ...newMlAttributes];

      await this.productModel.findByIdAndUpdate(
        product._id,
        { $set: { attributes: mergedAttributes } },
        { new: true },
      );

      // Synchronization is handled explicitly by publication flow enqueue.
      // await this.marketplaceOrchestratorService.syncProductToAllMarketplaces(product.id, marketplace._id.toString());

    } catch (error) {
      this.logger.error('Erro ao salvar atributos do produto:', error);
      throw error;
    }
  }

  async getProductAttributes(productId: number | string): Promise<{ required: CategoryAttributeInterface[], optional: CategoryAttributeInterface[] }> {
    try {
      // Assuming productId is the numeric legacy ID or the string _id. 
      // The calling code might pass either. The Model query handles `_id`. 
      // If `productId` argument is number, we should query `sku` or `legacyId`.
      // ProductModel has `sku` implies legacy ID. `_id` is default.

      let product: ProductDocument;
      if (typeof productId === 'string' && productId.length === 24) {
        product = await this.productModel.findById(productId).populate('category').exec();
      } else {
        product = await this.productModel.findOne({ sku: Number(productId) }).populate('category').exec();
      }

      if (!product || !product.attributes || product.attributes.length === 0) {
        return { required: [], optional: [] };
      }

      // We need to know which category/marketplace to fetch definitions for.
      // Usually attributes are mixed from multiple marketplaces? 
      // Or we focus on the context?
      // The original code took `productAttributes[0].categoryId` (not in schema anymore?)
      // We can use product.category.externalId and infer marketplace from attribute?

      // For now, let's grab the first attribute having a marketplaceId
      const attrWithMarketplace = product.attributes.find(a => a.marketplaceId);
      if (!attrWithMarketplace) return { required: [], optional: [] };

      // We assume attributes belong to the product's current category mapping?
      // Or we just fetch definitions for the product.category.externalId

      if (!product.category || !(product.category as any).externalId) {
        return { required: [], optional: [] };
      }

      // Need marketplace ID to call service?
      // attrWithMarketplace.marketplaceId is ObjectId. 
      // MercadoLivreAttributesService needs marketplaceId (number implied?) or just ignores it?
      // Adapter needs it?

      // Refetch definitions
      const categoryAttributes = await this.mercadoLivreAttributesService.getCategoryAttributes(
        (product.category as any).externalId,
        '1' // Legacy hardcoded? Or find marketplace by ID
      );

      const categoryAttributesMap = new Map(categoryAttributes.map(attr => [attr.id, attr]));

      const required: CategoryAttributeInterface[] = [];
      const optional: CategoryAttributeInterface[] = [];

      product.attributes.forEach(attr => {
        const def = categoryAttributesMap.get(attr.code);
        if (def) {
          const data: CategoryAttributeInterface = {
            id: def.id,
            name: def.name,
            value_type: def.value_type,
            values: def.values,
            tags: def.tags,
            hint: def.hint,
            allowed_units: def.allowed_units
          };
          if (def.tags?.required || def.tags?.mandatory) {
            required.push(data);
          } else {
            optional.push(data);
          }
        }
      });

      return { required, optional };

    } catch (error) {
      this.logger.error('Erro ao buscar atributos do produto:', error);
      throw error;
    }
  }
}
