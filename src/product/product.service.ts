import { Injectable, Inject, BadRequestException, NotFoundException, Logger, forwardRef, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from './schemas/product.schema';
import { BrandModel, BrandDocument } from './schemas/brand.schema';
import { ProductDiscoveryModel, ProductDiscoveryDocument } from './schemas/product-discovery.schema';
import { CreateFromDiscoveryDto } from './dto/create-from-discovery.dto';

import { QueueService } from '../queue/queue.service';

import { ProductCompatibilityService } from './services/product-compatibility.service';
import { ProductFilterService } from './services/product-filter.service';
import { PaginatedResponseDto, ProductFilterDto, ProductStatus } from './dto/product-filter.dto';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { ProductRepository } from './product.repository';
import { ProductMovementService, resolveMovementCondition } from './services/product-movement.service';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceDocument } from '../marketplace/schemas/marketplace.schema';
import { SearchService } from '../search/search.service';
import { ValidateMongoId } from '../common/decorators/validate-mongo-id.decorator';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { CategoryMappingService } from '../marketplace/services/category/category-mapping.service';
import { ProductTitleService } from './services/product-title.service';
import { ProductCategoryService } from './services/product-category.service';
import { UserProductivityService } from '../monitoring/user-productivity.service';
import { ProductivityType } from '../monitoring/schemas/user-productivity.schema';
import { MercadoLivreCompatibilityAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';

/** Evita exceção em `Decimal128.fromString` quando o cliente envia "" ou valor inválido. */
function detailsDecimal128(value: unknown): Types.Decimal128 | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().replace(',', '.');
  if (s === '') return undefined;
  try {
    return Types.Decimal128.fromString(s);
  } catch {
    return undefined;
  }
}

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    private readonly queueService: QueueService,
    private readonly productCompatibilityService: ProductCompatibilityService,
    private readonly productFilterService: ProductFilterService,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly productMovementService: ProductMovementService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly marketplaceDescriptionService: MarketplaceDescriptionService,
    @Inject(forwardRef(() => SearchService))
    private readonly searchService: SearchService,
    private readonly publicationLogService: PublicationLogService,
    @Inject(forwardRef(() => CategoryMappingService))
    private readonly categoryMappingService: CategoryMappingService,
    @Inject(forwardRef(() => ProductTitleService))
    private readonly productTitleService: ProductTitleService,
    private readonly userProductivityService: UserProductivityService,
    private readonly productCategoryService: ProductCategoryService,
    private readonly mercadoLivreCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    @InjectModel(BrandModel.name) private readonly brandModel: Model<BrandDocument>,
    @InjectModel(ProductDiscoveryModel.name) private readonly productDiscoveryModel: Model<ProductDiscoveryDocument>,
  ) { }

  @ValidateMongoId()
  async findOne(id: string, options?: { lean?: boolean }): Promise<ProductModel> {
    if (options?.lean) {
      return this.productRepository.findByIdLeanClean(id);
    }
    return this.productRepository.findByIdClean(id);
  }

  async findRecent(page: number = 1, limit: number = 10): Promise<ProductModel[]> {
    return this.productRepository.findAllClean({}, { page, limit, sort: { updatedAt: -1 } });
  }

  /**
   * Read-only lookup by partNumber + brandId. Returns null if not found.
   * Does NOT create any record — safe to call on every keystroke.
   */
  async lookup(partNumber: string, brandId: string, brandName?: string): Promise<ProductModel | null> {
    // Build brand filter: primary match on brand._id, fallback on brand.name for legacy
    // records that were created before the brand._id fix (those only have brand.name stored).
    const brandConditions: any[] = [{ 'brand._id': brandId }];
    if (brandName) {
      brandConditions.push({ 'brand.name': { $regex: `^${brandName.trim()}$`, $options: 'i' } });
    }

    const doc = await this.productRepository.findOneRaw({
      partNumber: { $regex: `^${partNumber.trim()}$`, $options: 'i' },
      $or: brandConditions,
    });
    if (!doc) return null;
    return this.productRepository.findByIdClean(doc.id);
  }

  async findAllModels(): Promise<ProductModel[]> {
    return this.productRepository.findAllClean({}, { limit: 0 });
  }

  @ValidateMongoId()
  async getProductCompletion(id: string) {
    const product = await this.productRepository.findByIdClean(id);
    if (!product) throw new NotFoundException('Produto não encontrado');

    const brandObj = product.brand || (product as any).brands;
    const hasBrand = !!brandObj?.name || !!brandObj?.shortName;
    const dataComplete = !!(product.partNumber && hasBrand);

    const imagesComplete = Array.isArray(product.images) && product.images.length > 0;

    const titles = await this.productTitleService.findByProductId(id);
    const titlesComplete = Array.isArray(titles) && titles.length > 0;

    const categoryComplete = !!product.category;

    const stockQty = await this.productRepository.calculateStock(id);
    const priceRaw = product.price ? Number(product.price) : 0;
    const inventoryComplete = stockQty > 0 && priceRaw > 0;

    const compatibilitiesComplete = await this.productRepository.existsCompatibility({ product: id });

    const parseNum = (v: any): number => {
      if (v === null || v === undefined || v === '') return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const w = parseNum((product as any).weight);
    const dim = (product as any).dimensions || {};
    const L = parseNum(dim.length);
    const Wd = parseNum(dim.width);
    const H = parseNum(dim.height);
    const dimensionsComplete = w > 0 && L > 0 && Wd > 0 && H > 0;

    const allRequired =
      dataComplete &&
      imagesComplete &&
      titlesComplete &&
      dimensionsComplete &&
      categoryComplete &&
      inventoryComplete;

    if (allRequired !== !!(product as any).readyToPublish) {
      await this.productRepository.update(id, { $set: { readyToPublish: allRequired } });
    }

    return {
      data: dataComplete,
      images: imagesComplete,
      titles: titlesComplete,
      category: categoryComplete,
      inventory: inventoryComplete,
      compatibilities: compatibilitiesComplete,
      dimensions: dimensionsComplete,
      readyToPublish: allRequired,
    };
  }

  async findForStore(page = 1, limit = 20, search?: string, featured?: boolean) {
    const query: any = { active: true }; // status changed to active in schema

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ name: regex }, { partNumber: regex }];
    }

    const total = await this.productRepository.count(query);
    const data = await this.productRepository.findAllClean(query, { page, limit, sort: { createdAt: -1 } });

    return { data, total, page, limit };
  }


  @ValidateMongoId()
  async findDocument(id: string): Promise<ProductDocument> {
    // buildIdQuery logic is now redundant if we trust validation, 
    // but repository might still need { _id: id } object.
    // However, findOne in repo likely expects filter.
    return this.productRepository.findOne({ _id: id });
  }

  // Efficiently calculate stock
  @ValidateMongoId()
  async getProductStock(id: string): Promise<number> {
    const product = await this.findDocument(id);
    if (!product) return 0;
    return this.productRepository.calculateStock(product.id || (product as any)._id.toString());
  }



  // Centralized Data Provider for Marketplace Adapters
  async getMarketplacePayloadData(idOrProduct: string | ProductDocument, marketplace?: MarketplaceDocument): Promise<any> {
    let productDoc: any;
    if (typeof idOrProduct === 'string') {
      const product = await this.findOne(idOrProduct);
      if (!product) return null;
      productDoc = (product as any).toObject ? (product as any).toObject() : product;
    } else {
      productDoc = (idOrProduct as any).toObject ? (idOrProduct as any).toObject() : idOrProduct;
    }

    // 1. Calculate Trusted Stock from stock_movements aggregation (source of truth)
    const available_quantity = await this.getProductStock(productDoc.id || productDoc._id);

    // 2. Fetch Latest Price/Cost from Movements if needed
    // Use costPrice from document if available
    let costPrice = Number(productDoc.costPrice);
    let lastMovement = null;

    if (!costPrice || costPrice === 0) {
      lastMovement = await this.productRepository.findLatestMovementWithPrice(productDoc.id || productDoc._id);
      costPrice = lastMovement?.price ? Number(lastMovement.price) : 0;
    }

    // 3. Normalize Attributes
    // Transform legacy/mongo attributes into a standard array if needed, though adapters usually handle this.
    // For now, passing raw attributes is fine, but we ensure they exist.
    const attributes = productDoc.attributes || [];

    // 4. Generate Description Template if Marketplace provided
    let marketplaceDescription = productDoc.description;
    if (marketplace) {
      try {
        const templateDesc = await this.marketplaceDescriptionService.generateDescription(productDoc, marketplace.name);
        if (templateDesc) {
          marketplaceDescription = templateDesc;
        }
      } catch (error) {
        this.logger.warn(`Failed to generate template description for ${marketplace.name}: ${error.message}`);
      }
    }


    // 5. Normalize Category
    // Ensure category is usable both as object and ID
    let normalizedCategory = productDoc.category;
    let categoryId = undefined;

    if (normalizedCategory) {
      if (typeof normalizedCategory === 'object') {
        categoryId = normalizedCategory.id || normalizedCategory._id;
        // Ensure it's a plain object if it was a doc
        normalizedCategory = (normalizedCategory as any).toObject ? (normalizedCategory as any).toObject() : normalizedCategory;
        normalizedCategory.id = categoryId ? String(categoryId) : undefined;
        normalizedCategory._id = categoryId ? String(categoryId) : undefined;
      } else {
        categoryId = normalizedCategory;
        // Reconstruct object if it was just a string ID
        normalizedCategory = {
          id: String(categoryId),
          _id: String(categoryId),
          externalId: String(categoryId)
        };
      }

      // NEW: Resolve Mapped Category for Marketplace
      if (marketplace && categoryId) {
        try {
          this.logger.debug(`Resolving category mapping for Product ${productDoc._id} (Category: ${categoryId}) -> Marketplace ${marketplace.name}`);
          const mappedExternalId = await this.categoryMappingService.resolveCategory(String(categoryId), String(marketplace.id || marketplace._id));

          if (mappedExternalId) {
            this.logger.log(`Category Mapped: ${categoryId} -> ${mappedExternalId} for ${marketplace.name}`);
            normalizedCategory.externalId = mappedExternalId;
          } else {
            this.logger.warn(`No category mapping found for ${categoryId} on ${marketplace.name}. Using internal ID as fallback.`);
            // Fallback to internal ID if no mapping exists, to pass generic validation
            // But functionally this might fail if marketplace strictly requires its own taxonomy ID.
            if (!normalizedCategory.externalId) {
              normalizedCategory.externalId = String(categoryId);
            }
          }
        } catch (err) {
          this.logger.error(`Error resolving category mapping: ${err.message}`);
          // Fallback
          if (!normalizedCategory.externalId) {
            normalizedCategory.externalId = String(categoryId);
          }
        }
      } else {
        // Fallback for when no marketplace context is available
        if (!normalizedCategory.externalId) {
          normalizedCategory.externalId = String(categoryId);
        }
      }
    }

    // Explicitly set category_id for legacy checks that might look for it
    productDoc.category_id = normalizedCategory?.externalId || (categoryId ? String(categoryId) : undefined);
    productDoc.categoryId = categoryId ? String(categoryId) : undefined;
    productDoc.category = normalizedCategory;

    // 5. Return Standardized Object
    return {
      ...productDoc,
      _id: productDoc._id, // Ensure _id is accessible
      price: productDoc.price ? Number(productDoc.price) : 0,
      costPrice,
      quantity: available_quantity, // TRUSTED STOCK
      stock: available_quantity,    // Standard alias
      available_quantity,           // Standard alias
      marketplaceDescription,       // Expose generated description
      productMovements: lastMovement ? [lastMovement] : [], // Only need latest for price reference? Or maybe none? 
      // Adapters shouldn't calc stock from this anymore.
      productImages: productDoc.images || [],
      // [REF] Fetch titles from service
      productTitles: await this.productTitleService.findByProductId(productDoc._id),
      // Ensure dimensions are numbers
      dimensions: {
        length: Number(productDoc.dimensions?.length || productDoc.length || 0),
        width: Number(productDoc.dimensions?.width || productDoc.width || 0),
        height: Number(productDoc.dimensions?.height || productDoc.height || 0),
        weight: Number(productDoc.weight || 0),
      }
    };
  }

  // Deprecated/Alias for backward compatibility until refactor complete
  async findOneForPublish(id: string): Promise<any> {
    return this.getMarketplacePayloadData(id);
  }

  async getInventory(id: string) {
    const product = await this.findOne(id);
    if (!product) return { productMovements: [], boxItems: [] };

    // Delegate to specialized service
    const movements = await this.productMovementService.findByProduct(product._id);

    // Map allocations to the expected 'boxItems' format for the WMS
    const boxItems = (product.allocations || []).map(alloc => ({
      boxId: alloc.boxId || alloc._id,
      quantity: alloc.quantity,
      condition: { name: 'Normal' }, // Default
      box: {
        code: alloc.boxCode || alloc.code || 'N/A', // Prefer Box Code, fallback to Location Code
        warehouse: { name: 'Principal' }
      }
    }));

    return {
      productMovements: movements,
      boxItems: boxItems,
    };
  }

  async getCompatibilities(id: string) {
    const product = await this.findOne(id);
    const compatibilities = await this.getProductCompatibilities(id);
    return compatibilities || [];
  }

  async getAttributes(id: string) {
    const product = await this.findOne(id);
    return {
      attributes: product?.attributes || [],
      // Mapped fields if they exist in schema or embedded
      ncm: (product as any).tax?.ncm || (product as any).ncm,
      unit: product?.unit,
      warranty: (product as any).warranty,
      origin: (product as any).tax?.origin || (product as any).origin,
      cest: (product as any).tax?.cest || (product as any).cest,
      cfop: (product as any).tax?.cfop || (product as any).cfop,
      csosn: (product as any).tax?.csosn || (product as any).csosn,
      tax: (product as any).tax
    };
  }

  async getImages(id: string) {
    const product = await this.findOne(id);
    return product?.images || [];
  }

  async getCategory(id: string) {
    const product = await this.findOne(id);
    if (!product) return null;
    await (product as any).populate('category');
    return product.category;
  }

  async checkPartNumberBrandUniqueness(partNumber: string, brandId: number | string, excludeProductId?: string): Promise<boolean> {
    const query: any = { partNumber, 'brand._id': brandId };

    if (excludeProductId) {
      if (Types.ObjectId.isValid(excludeProductId)) {
        query._id = { $ne: excludeProductId };
      } else {
        // Legacy fallback if needed, but per request strictly removing
        // However, this query is logical uniqueness.
        // Let's assume passed ID is always ObjectId string now.
        query._id = { $ne: excludeProductId };
      }
    }

    return this.productRepository.checkUniqueness(query);
  }

  async existsMovementReference(reference: string): Promise<boolean> {
    return this.productRepository.existsMovementReference(reference);
  }

  async create(data: Partial<any>, userId?: string): Promise<ProductModel> {

    try {
      const existingProduct = await this.productRepository.findOneRaw({
        partNumber: data.partNumber
      });

      if (existingProduct) {
        this.logger.log(`Produto encontrado: ${existingProduct.partNumber}`);

        // Auto-fix corrupt category if present (Migration on read)
        if (existingProduct.category && typeof existingProduct.category === 'object' && !(existingProduct.category instanceof Types.ObjectId)) {
          const catObj: any = existingProduct.category;
          if (catObj.id || catObj._id) {
            const newId = catObj._id || catObj.id;
            if (Types.ObjectId.isValid(newId)) {
              existingProduct.category = new Types.ObjectId(newId);
              // We must save this fix immediately or let the update below handle it.
              // The below update uses productRepository.save(existingProduct).
              // But we must ensure existingProduct is a Mongoose Document. findOneRaw returns Document.
            }
          }
        }

        if (data.barcode) existingProduct.barcode = data.barcode;
        if (data.active !== undefined) existingProduct.active = data.active;
        if (data.brand) {
          if (!existingProduct.brand) existingProduct.brand = {} as any;
          // Repair missing brand._id for products created before the brand._id fix
          if (data.brand.id || data.brand._id) {
            const brandIdStr = String(data.brand.id || data.brand._id);
            if (!existingProduct.brand._id || existingProduct.brand._id !== brandIdStr) {
              existingProduct.brand._id = brandIdStr;
            }
          }
          if (data.brand.isGenuine !== undefined) existingProduct.brand.isGenuine = data.brand.isGenuine;
        }
        await this.productRepository.save(existingProduct);
        const updated = await this.productRepository.findByIdClean(existingProduct.id);

        // Indexing
        this.searchService.indexProduct(updated).catch(e => this.logger.error(`Failed to index product on update: ${e.message}`));

        return updated;
      }

      // Create New
      const slugBase = `${data.partNumber}-${data.brand?.name || 'generic'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

      const newProductData = {
        name: data.name || data.partNumber,
        partNumber: data.partNumber,
        slug: slugBase,
        description: data.description,
        tax: {
          ncm: data.ncm,
          cfop: data.cfop,
          csosn: data.csosn,
          cest: data.cest,
          origin: data.origin
        },
        price: data.price ? Types.Decimal128.fromString(data.price.toString()) : Types.Decimal128.fromString('0'),
        costPrice: data.costPrice ? Types.Decimal128.fromString(data.costPrice.toString()) : undefined,
        weight: data.weight ? Types.Decimal128.fromString(data.weight.toString()) : undefined,
        dimensions: data.dimensions ? {
          length: Types.Decimal128.fromString(data.dimensions.length?.toString() || '0'),
          width: Types.Decimal128.fromString(data.dimensions.width?.toString() || '0'),
          height: Types.Decimal128.fromString(data.dimensions.height?.toString() || '0')
        } : undefined,
        active: true,
        brand: data.brand ? {
          _id: String(data.brand.id || data.brand._id || ''),
          name: data.brand.name,
          logoUrl: data.brand.logoUrl,
          isGenuine: data.brand.isGenuine
        } : undefined,
        category: await (async () => {
          if (data.marketplaceCategory && data.marketplaceId) {
            try {
              const resolvedInternalId = await this.categoryMappingService.resolveCategory(
                data.marketplaceCategory,
                data.marketplaceId
              );
              if (resolvedInternalId) {
                return new Types.ObjectId(resolvedInternalId);
              }
            } catch (e) {
              this.logger.warn(`Failed to resolve category ${data.marketplaceCategory}: ${e.message}`);
            }
          }

          if (!data.category) return undefined;
          const cat = data.category;
          if (cat instanceof Types.ObjectId) return cat;
          if (typeof cat === 'string') return new Types.ObjectId(cat);
          if (typeof cat === 'object') {
            // Handle snapshot/populated object
            const id = cat._id || cat.id;
            if (id) return new Types.ObjectId(id);
          }
          return undefined;
        })(),
        unit: data.unit ? {
          id: data.unit.id,
          code: data.unit.code,
          name: data.unit.name
        } : undefined,
        images: [],
        attributes: [],
        allocations: []
      };

      const savedProduct = await this.productRepository.create(newProductData);
      const newProductClean = await this.productRepository.findByIdClean((savedProduct as any).id);

      // Update Category Counts
      if (newProductClean.category) {
        this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on create: ${e.message}`));
      }

      // Indexing
      this.searchService.indexProduct(newProductClean).catch(e => this.logger.error(`Failed to index product on create: ${e.message}`));

      // Log Productivity - Create
      if (userId) {
        this.userProductivityService.logActivity(userId, ProductivityType.CREATE, {
          productId: newProductClean._id,
          partNumber: newProductClean.partNumber,
          timestamp: new Date()
        }).catch(e => this.logger.error(`Failed to log productivity: ${e.message}`));
      }

      // Update Category Counts (Async)
      this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on create: ${e.message}`));

      return newProductClean;

    } catch (error) {
      this.logger.error('Erro ao criar/verificar produto:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateDetails(id: string, data: any): Promise<void> {
    const update: any = {};

    if (data.barcode !== undefined) update.barcode = data.barcode;
    if (data.isGenuine !== undefined) update.isGenuine = data.isGenuine == 1 || data.isGenuine === true || data.isGenuine === 'true';

    if (data.ncm !== undefined) update['tax.ncm'] = data.ncm;
    if (data.cfop !== undefined) update['tax.cfop'] = data.cfop;
    if (data.csosn !== undefined) update['tax.csosn'] = data.csosn;
    if (data.cest !== undefined) update['tax.cest'] = data.cest;
    if (data.origin !== undefined) update['tax.origin'] = data.origin;

    if (data.description !== undefined) update.description = data.description;
    if (data.details !== undefined) update.details = data.details;
    if (data.attributes !== undefined) update.attributes = data.attributes;
    if (data.condition !== undefined) update.condition = data.condition;

    const height = detailsDecimal128(data.height);
    if (height !== undefined) update['dimensions.height'] = height;
    const width = detailsDecimal128(data.width);
    if (width !== undefined) update['dimensions.width'] = width;
    const length = detailsDecimal128(data.length);
    if (length !== undefined) update['dimensions.length'] = length;
    const weight = detailsDecimal128(data.weight);
    if (weight !== undefined) update.weight = weight;

    if (Object.keys(update).length === 0) {
      return;
    }

    await this.productRepository.update(id, { $set: update });

    // Indexing
    const updatedProduct = await this.productRepository.findByIdClean(id);
    this.searchService.indexProduct(updatedProduct).catch(e => this.logger.error(`Failed to index product on updateDetails: ${e.message}`));

    // REMOVED: Manual Publication Trigger (Handled by ProductWatcherService)
  }

  @ValidateMongoId()
  async update(id: string, data: Partial<any>): Promise<ProductModel> {
    this.logger.debug(`Updating product ${id}`);
    try {
      const product = await this.findDocument(id);
      if (!product) {
        throw new NotFoundException(`Produto com ID ${id} não encontrado`);
      }

      if (data.name) product.name = data.name;
      if (data.partNumber) product.partNumber = data.partNumber;
      if (data.description) product.description = data.description;
      if (data.details) product.details = data.details;
      if (data.active !== undefined) product.active = data.active;

      if (data.oemCodes) product.oemCodes = data.oemCodes;
      if (data.applicationSummary) product.applicationSummary = data.applicationSummary;

      if (data.price !== undefined) product.price = Types.Decimal128.fromString(data.price.toString());
      if (data.costPrice !== undefined) product.costPrice = Types.Decimal128.fromString(data.costPrice.toString());
      if (data.weight !== undefined) product.weight = Types.Decimal128.fromString(data.weight.toString());

      if (data.dimensions) {
        product.dimensions = {
          length: Types.Decimal128.fromString(data.dimensions.length?.toString() || '0'),
          width: Types.Decimal128.fromString(data.dimensions.width?.toString() || '0'),
          height: Types.Decimal128.fromString(data.dimensions.height?.toString() || '0')
        };
      }

      if (data.category) {
        product.category = new Types.ObjectId(data.category.id || data.category);
      }

      if (data.brand) {
        product.brand = {
          _id: data.brand.id,
          name: data.brand.name,
          logoUrl: data.brand.logoUrl,
          isGenuine: data.brand.isGenuine,
          shortName: data.brand.shortName,
          amazonName: data.brand.amazonName,
          fullName: data.brand.fullName,
          externalId: data.brand.externalId
        };
      }

      const updatedProduct = await this.productRepository.save(product);

      // REMOVED: Manual Publication Trigger (Handled by ProductWatcherService)

      // Update Category Counts if relevant fields changed
      if (data.category || data.active !== undefined) {
        this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on update: ${e.message}`));
      }

      return this.productRepository.findByIdClean(updatedProduct.id);
    } catch (error) {
      this.logger.error('Erro ao atualizar produto:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateImages(id: string, imageDataList: {
    url: string;
    key: string;
    filename?: string;
    mimeType?: string;
  }[]): Promise<ProductModel> {
    try {
      const product = await this.findDocument(id);
      if (!product) {
        throw new NotFoundException(`Produto com ID ${id} não encontrado`);
      }

      product.images = imageDataList.map((img, index) => ({
        url: img.url,
        key: img.key,
        originalName: img.filename || `image-${index}`,
        mimeType: img.mimeType,
        main: index === 0,
        order: index,
        status: 'active'
      }));

      const updatedProduct = await this.productRepository.save(product);

      this.logger.log(`[DEBUG] ProductService.updateImages: Save complete for ${id}. ID: ${updatedProduct._id}`);

      // REMOVED: Manual Publication Trigger (Handled by ProductWatcherService)

      return this.productRepository.findByIdClean(updatedProduct.id);
    } catch (error) {
      this.logger.error('Erro ao atualizar imagens do produto:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateTitles(id: string, titleDataList: {
    title: string;
    locale?: string;
    marketplaceId?: string;  // Changed from number to string to match ProductTitleService
  }[], userId?: number): Promise<ProductModel> {
    try {
      // FIXED: Delegate to ProductTitleService which has proper externalId preservation and deduplication
      // The old implementation was naively replacing the entire titles array and setting externalId: null
      // This caused the watcher to treat all titles as new, creating duplicate products in marketplaces

      await this.productTitleService.updateTitles(id, titleDataList, userId);

      // Return the updated product
      return this.productRepository.findByIdClean(id);
    } catch (error) {
      this.logger.error('Erro ao atualizar títulos do produto:', error);
      throw error;
    }
  }

  @ValidateMongoId(0)
  async updateTitle(productId: string, titleId: string, updateData: any): Promise<ProductModel> {
    try {
      const product = await this.findDocument(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      // [REF] Delegate to ProductTitleService which wraps ListingService
      await this.productTitleService.update(titleId, {
        title: updateData.title,
        locale: updateData.locale,
        marketplaceId: updateData.marketplaceId ? new Types.ObjectId(updateData.marketplaceId) : undefined
      } as any);

      // Return refreshed product
      return this.productRepository.findByIdClean(productId);
    } catch (error) {
      this.logger.error('Erro ao atualizar título individual:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateCategory(id: string, data: any): Promise<ProductModel> {
    const product = await this.findDocument(id);
    if (!product) throw new NotFoundException(`Produto com ID ${id} não encontrado.`);

    product.category = new Types.ObjectId(data.id || data);

    const saved = await this.productRepository.save(product);

    // Update Category Counts
    this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on updateCategory: ${e.message}`));

    return this.productRepository.findByIdClean(saved.id);
  }


  @ValidateMongoId()
  async createMovement(productId: string, movementData: any): Promise<any> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      return this.productMovementService.create({
        productId: product._id,
        type: (movementData.type === 'entrada' || movementData.type === 'inbound') ? 'inbound' :
          (movementData.type === 'saida' || movementData.type === 'outbound') ? 'outbound' :
            (movementData.type === 'transferencia' || movementData.type === 'transfer') ? 'transfer' : 'adjustment',
        quantity: movementData.quantity,
        price: movementData.price,
        reason: movementData.reason,
        reference: movementData.reference,
        condition: resolveMovementCondition(movementData.condition, movementData.conditionId),
        situation: movementData.situation,
        observation: movementData.observation,
        // Forward new structure fields
        origin: movementData.origin,
        metadata: movementData.metadata,
        orderId: movementData.orderId
      });
    } catch (error) {
      this.logger.error('Erro ao criar movimento:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateMovement(productId: string, movementId: string, movementData: any): Promise<any> {
    try {
      const updatedMovement = await this.productMovementService.update(movementId, movementData);

      // Queue trigger removed: product.movement_updated

      return updatedMovement;
    } catch (error) {
      this.logger.error('Erro ao atualizar movimento:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async syncInventory(id: string, inventoryData: any): Promise<any> {
    try {
      const product = await this.findOne(id);
      if (!product) throw new NotFoundException(`Produto com ID ${id} não encontrado`);

      // Create inbound movement
      const movement = await this.createMovement(id, {
        type: 'inbound',
        quantity: inventoryData.quantity || 0,
        reason: 'Sincronização com marketplace',
        condition: inventoryData.condition,
        conditionId: inventoryData.conditionId,
      });

      // Queue trigger removed: product.sync_movement

      return movement;
    } catch (error) {
      this.logger.error('Erro ao sincronizar estoque:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async getMovements(productId: string): Promise<any[]> {
    const product = await this.findOne(productId);
    if (!product) return [];
    return this.productMovementService.findByProduct(product._id as any);
  }

  @ValidateMongoId()
  async remove(id: string): Promise<void> {
    try {
      const product = await this.findDocument(id);
      if (!product) throw new NotFoundException(`Produto com ID ${id} não encontrado`);

      // Soft delete using active: false
      // If we are strictly Mongoose now, we verify _id
      product.active = false;
      await (product as ProductDocument).save();

      // Update Category Counts
      this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on remove: ${e.message}`));

      // Queue trigger removed: product.remove

    } catch (error) {
      this.logger.error('Erro ao remover produto:', error);
      throw error;
    }
  }

  // Migration methods removed
  async migrateImagesToRelational(): Promise<void> {
    this.logger.log('Migration methods deprecated in MongoDB refactor');
  }

  async migrateTitlesToRelational(): Promise<void> {
    this.logger.log('Migration methods deprecated in MongoDB refactor');
  }

  @ValidateMongoId()
  async getProductCompatibilities(productId: string): Promise<any[]> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      return this.productCompatibilityService.getCompatibilitiesByProduct(product._id);
    } catch (error) {
      this.logger.error('Erro ao buscar compatibilidades do produto:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async addProductCompatibilities(
    productId: string,
    vehicleIds: string[],
    vehicleDetails?: Array<{
      id: string;
      name?: string;
      brand?: string;
      model?: string;
      year?: string;
      version?: string;
      engine?: string;
      fuelType?: string;
      transmission?: string;
    }>
  ): Promise<any[]> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      const result = await this.productCompatibilityService.createMultipleCompatibilitiesBatch({
        productId: String(product._id),
        vehicleIds,
        vehicleDetails
      });


      return result;
    } catch (error) {
      this.logger.error('Erro ao adicionar compatibilidades ao produto:', error);
      throw error;
    }
  }

  @ValidateMongoId(0) // Validate productId
  async removeProductCompatibility(productId: string, compatibilityId: string): Promise<void> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      await this.productCompatibilityService.deleteCompatibility(compatibilityId);

      await this.queueService.addToQueue({
        type: 'product.sync_compatibilities',
        productId: product._id,
        metadata: {
          action: 'remove_compatibility',
          compatibilityId
        }
      });

      this.logger.log(`Compatibilidade ${compatibilityId} removida do produto ${productId}`);
    } catch (error) {
      this.logger.error('Erro ao remover compatibilidade:', error);
      throw error;
    }
  }

  @ValidateMongoId(0)
  async syncCompatibilitiesWithMarketplace(productId: string, marketplaceId: string): Promise<any> {
    try {
      const product = await this.findOne(productId);
      if (!product) {
        throw new NotFoundException(`Produto com ID ${productId} não encontrado`);
      }

      const marketplace = await this.marketplaceRegistry.resolveMarketplace(marketplaceId);
      if (!marketplace) {
        throw new NotFoundException(`Marketplace com ID ${marketplaceId} não encontrado`);
      }

      const resolvedMarketplaceId = String(marketplace._id);

      // Buscar títulos do produto para o marketplace específico
      // [REF] Fetch from service
      const allTitles = await this.productTitleService.findByProductId(product._id);
      const productTitles = allTitles.filter((title: any) => String(title.marketplaceId) === resolvedMarketplaceId);

      if (productTitles.length === 0) {
        throw new BadRequestException(`Produto não possui títulos para o marketplace ${marketplace.name}`);
      }

      const compatibilities = await this.getProductCompatibilities(productId);

      if (compatibilities.length === 0) {
        throw new BadRequestException('Produto não possui compatibilidades cadastradas');
      }

      // Preparar dados para sincronização
      const syncData = {
        itemIds: productTitles.filter(t => t.externalId).map(t => t.externalId),
        compatibilityIds: compatibilities.map(c => c.vehicleId)
      };

      // Adicionar à fila para sincronização
      await this.queueService.addToQueue({
        type: 'product-sync-compatibilities',
        productId,
        marketplaceId: resolvedMarketplaceId,
        metadata: {
          action: 'sync_compatibilities',
          syncData
        }
      });

      this.logger.log(`Compatibilidades do produto ${productId} adicionadas à fila para sincronização com ${marketplace.name}`);

      return {
        message: 'Compatibilidades adicionadas à fila para sincronização',
        productId,
        marketplace: marketplace.name,
        titleCount: productTitles.length,
        compatibilityCount: compatibilities.length
      };
    } catch (error) {
      this.logger.error('Erro ao sincronizar compatibilidades com marketplace:', error);
      throw error;
    }
  }

  async syncSpecificCompatibilitiesWithMarketplace(productId: string, marketplaceId: string, vehicleIds: string[]): Promise<any> {
    try {
      const product = await this.findOne(productId);
      if (!product) {
        throw new NotFoundException(`Produto com ID ${productId} não encontrado`);
      }

      const marketplace = await this.marketplaceRegistry.resolveMarketplace(marketplaceId);
      if (!marketplace) {
        throw new NotFoundException(`Marketplace com ID ${marketplaceId} não encontrado`);
      }

      const resolvedMarketplaceId = String(marketplace._id);

      // [REF] Fetch titles
      const allTitles = await this.productTitleService.findByProductId(product._id);
      const productTitles = allTitles.filter((title: any) => String(title.marketplaceId) === resolvedMarketplaceId);

      if (productTitles.length === 0) {
        throw new BadRequestException(`Produto não possui títulos para o marketplace ${marketplace.name}`);
      }

      if (!vehicleIds || vehicleIds.length === 0) {
        throw new BadRequestException('Nenhum vehicleId informado para sincronização direta');
      }

      if (marketplace.name !== 'Mercado Livre') {
        throw new BadRequestException(`Sincronização direta ainda não implementada para ${marketplace.name}`);
      }

      const results: any[] = [];
      let successCount = 0;
      let errorCount = 0;

      const chunkSize = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < vehicleIds.length; i += chunkSize) {
        chunks.push(vehicleIds.slice(i, i + chunkSize));
      }

      for (const title of productTitles) {
        if (!title.externalId) {
          results.push({ title: title.title, status: 'skipped', reason: 'missing_externalId' });
          continue;
        }
        for (const chunk of chunks) {
          const payloadML = {
            products: chunk.map((id) => ({ id })),
            site_id: 'MLB',
            domain_id: 'MLB-CARS_AND_VANS',
          };
          try {
            const resp = await this.mercadoLivreCompatibilityAdapter.syncCompatibility(
              title.externalId,
              payloadML,
            );
            results.push({
              title: title.title,
              itemId: title.externalId,
              status: 'success',
              count: chunk.length,
              response: resp,
            });
            successCount += chunk.length;
          } catch (err: any) {
            this.logger.warn(
              `syncCompatibility falhou item=${title.externalId} chunk=${chunk.length}: ${err?.message}`,
            );
            results.push({
              title: title.title,
              itemId: title.externalId,
              status: 'error',
              message: err?.response?.message || err?.message,
              cause: err?.response?.cause || err?.response,
            });
            errorCount += chunk.length;
          }
        }
      }

      return {
        message: 'Compatibilidades diretas sincronizadas imediatamente',
        productId,
        marketplace: marketplace.name,
        titleCount: productTitles.length,
        compatibilityCount: vehicleIds.length,
        successCount,
        errorCount,
        results
      };
    } catch (error) {
      this.logger.error('Erro ao sincronizar compatibilidades diretas com marketplace:', error);
      throw error;
    }
  }

  async getCompatibilityStats(productId: string): Promise<any> {
    try {
      const product = await this.findOne(productId);

      if (!product) {
        throw new NotFoundException(`Produto com ID ${productId} não encontrado`);
      }

      const compatibilities = await this.getProductCompatibilities(productId);

      // Estatísticas por marca de veículo
      const brandStats = compatibilities.reduce((acc, comp) => {
        const brand = comp.vehicleBrand || 'Não especificada';
        acc[brand] = (acc[brand] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estatísticas por ano
      const yearStats = compatibilities.reduce((acc, comp) => {
        const year = comp.vehicleYear || 'Não especificado';
        acc[year] = (acc[year] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estatísticas por combustível
      const fuelStats = compatibilities.reduce((acc, comp) => {
        const fuel = comp.vehicleFuelType || 'Não especificado';
        acc[fuel] = (acc[fuel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalCompatibilities: compatibilities.length,
        brandStats,
        yearStats,
        fuelStats,
        syncedWithMarketplace: compatibilities.filter(c => c.syncedWithMarketplace).length,
        notSynced: compatibilities.filter(c => !c.syncedWithMarketplace).length
      };
    } catch (error) {
      this.logger.error('Erro ao buscar estatísticas de compatibilidade:', error);
      throw error;
    }
  }

  /**
   * Atualizar keywords de compatibilidade quando compatibilidades são alteradas
   */
  @ValidateMongoId()
  async updateCompatibilityKeywords(productId: string): Promise<void> {
    await this.productFilterService.updateProductCompatibilityKeywords(productId);
  }

  async findProductsWithCompatibilitySearch(filters: ProductFilterDto): Promise<PaginatedResponseDto<ProductModel>> {
    // Usar o método existente mas sem incluir compatibilities no resultado
    const searchFilters = { ...filters };
    delete searchFilters.includeCompatibilities; // Remover para evitar performance issues

    return await this.productFilterService.findProducts(searchFilters);
  }

  async findByBarcode(barcode: string): Promise<ProductModel | null> {
    return this.productRepository.findOneClean({
      $or: [
        { barcode: barcode },
        { ean: barcode },
        { 'attributes.value': barcode }
      ]
    });
  }

  async searchByBarcodeOrName(query: string): Promise<ProductModel[]> {
    return this.productRepository.findAllClean({
      $or: [
        { barcode: query },
        { ean: query },
        { partNumber: new RegExp(query, 'i') },
        { name: new RegExp(query, 'i') },
        { 'brand.name': new RegExp(query, 'i') }
      ],
      active: true
    }, {
      limit: 20,
      sort: { updatedAt: -1 }
    });
  }

  async countByCategory(categoryId: string): Promise<number> {
    const query = { category: new Types.ObjectId(categoryId), active: true };
    return this.productRepository.count(query);
  }

  async createFromDiscovery(dto: CreateFromDiscoveryDto): Promise<ProductModel> {
    // 1. Busca a marca
    const brand = await this.brandModel.findById(dto.brandId).lean().exec();
    if (!brand) throw new BadRequestException('Marca não encontrada');

    // 2. Dados do discovery (se houver)
    let discoveryData: any = {};
    if (dto.discoveryId && Types.ObjectId.isValid(dto.discoveryId)) {
      const discovery = await this.productDiscoveryModel
        .findById(dto.discoveryId)
        .lean()
        .exec();
      if (discovery?.data) discoveryData = discovery.data;
    }

    // 3. Duplicate partNumber guard — return existing product instead of throwing so
    // the identify flow is idempotent (lookup may miss it if brand._id type differs).
    const existing = await this.productRepository.findOneRaw({ partNumber: dto.partNumber });
    if (existing) return this.productRepository.findByIdClean(existing.id);

    // 4. Generate slug (same pattern as create())
    const slugBase = `${dto.partNumber}-${brand.name || 'generic'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    // 5. Cria o produto com campos pré-preenchidos
    const created = await this.productRepository.create({
      name: discoveryData.name || dto.partNumber,
      slug: slugBase,
      partNumber: dto.partNumber,
      barcode: dto.barcode,
      brand: {
        _id: brand._id,
        name: brand.name,
        shortName: (brand as any).shortName,
        logoUrl: (brand as any).logoUrl,
        isGenuine: (brand as any).isGenuine,
      },
      description: discoveryData.description ?? '',
      details: discoveryData.details ?? '',
      weight: discoveryData.weight ? Types.Decimal128.fromString(discoveryData.weight.toString()) : undefined,
      dimensions: (discoveryData.height || discoveryData.width || discoveryData.length) ? {
        height: Types.Decimal128.fromString((discoveryData.height || 0).toString()),
        width: Types.Decimal128.fromString((discoveryData.width || 0).toString()),
        length: Types.Decimal128.fromString((discoveryData.length || 0).toString()),
      } : undefined,
      status: ProductStatus.DRAFT,
    });

    const result = await this.productRepository.findByIdClean(created.id);

    // 6. Elasticsearch indexing
    this.searchService.indexProduct(result).catch(e => this.logger.error(`Failed to index product on createFromDiscovery: ${e.message}`));

    return result;
  }
}
