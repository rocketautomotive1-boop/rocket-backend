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
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { StockService } from '../stock/stock.service';
import { resolveMovementCondition, resolveMovementType } from '../stock/domain/movement-type';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceDocument } from '../marketplace/schemas/marketplace.schema';
import { ValidateMongoId } from '../common/decorators/validate-mongo-id.decorator';
import { buildUniqueProductSlug, shouldRegenerateSlugForTitle } from './utils/product-slug.util';
import { normalizeCode } from './utils/code-key.util';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { CategoryMappingService } from '../marketplace/services/category/category-mapping.service';
import { ProductTitleService } from './services/product-title.service';
import { ProductCategoryService } from './services/product-category.service';
import { TitleCategoryHintService } from './services/title-category-hint.service';
import { ProductShortTitleService } from './services/product-short-title.service';
import { UserProductivityService } from '../monitoring/user-productivity.service';
import { ProductivityType } from '../monitoring/schemas/user-productivity.schema';
import { MercadoLivreCompatibilityAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRODUCT_EVENTS, ProductUpdatedEvent } from './events/product.events';
import { ProductReadinessService } from './services/product-readiness.service';
import {
  PRODUCT_SECTION_EVENTS,
  ProductDimensionsSavedEvent,
  ProductImagesSavedEvent,
  ProductCategorySavedEvent,
  ProductDataSavedEvent,
} from './events/product-section-saved.event';

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

function toOptionalObjectId(value?: string): Types.ObjectId | undefined {
  if (!value || value === 'system' || value === 'SYSTEM') return undefined;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly productRepository: ProductRepository,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    @Inject(STORE_LISTING_PORT) private readonly storeListingPort: StoreListingPort,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    private readonly queueService: QueueService,
    private readonly productCompatibilityService: ProductCompatibilityService,
    private readonly productFilterService: ProductFilterService,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly stockService: StockService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly marketplaceDescriptionService: MarketplaceDescriptionService,
    private readonly publicationLogService: PublicationLogService,
    @Inject(forwardRef(() => CategoryMappingService))
    private readonly categoryMappingService: CategoryMappingService,
    @Inject(forwardRef(() => ProductTitleService))
    private readonly productTitleService: ProductTitleService,
    private readonly userProductivityService: UserProductivityService,
    private readonly productCategoryService: ProductCategoryService,
    private readonly titleCategoryHintService: TitleCategoryHintService,
    private readonly productShortTitleService: ProductShortTitleService,
    private readonly mercadoLivreCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    @InjectModel(BrandModel.name) private readonly brandModel: Model<BrandDocument>,
    @InjectModel(ProductDiscoveryModel.name) private readonly productDiscoveryModel: Model<ProductDiscoveryDocument>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => ProductReadinessService))
    private readonly productReadinessService: ProductReadinessService,
  ) { }

  @ValidateMongoId()
  async findOne(id: string, options?: { lean?: boolean }): Promise<ProductModel> {
    if (options?.lean) {
      return this.productRepository.findByIdLeanClean(id);
    }
    return this.productRepository.findByIdClean(id);
  }

  /**
   * Para rotas públicas (storefront): aceita slug OU _id, já que URLs antigas
   * indexadas por _id continuam válidas durante a transição para slug.
   */
  async findOneBySlugOrId(idOrSlug: string): Promise<ProductModel | null> {
    if (Types.ObjectId.isValid(idOrSlug)) {
      return this.productRepository.findByIdClean(idOrSlug);
    }
    const doc = await this.productRepository.findOneRaw({ slug: idOrSlug });
    return doc ? this.productRepository.findByIdClean(doc.id) : null;
  }

  async findRecent(page: number = 1, limit: number = 10): Promise<ProductModel[]> {
    return this.productRepository.findAllClean({}, { page, limit, sort: { updatedAt: -1 } });
  }

  /**
   * Batch summaries (id + name + main image) for badges/cards (e.g. notifications).
   * Deduplicates ids, single indexed `$in` query, minimal projection.
   */
  async getSummariesByIds(
    ids: string[],
  ): Promise<Array<{ id: string; name: string; image: string | null }>> {
    const unique = Array.from(new Set((ids || []).filter(Boolean).map(String)));
    if (unique.length === 0) return [];

    const docs = await this.productRepository.findSummariesByIds(unique);
    return docs.map((doc) => {
      const images: any[] = Array.isArray(doc.images) ? doc.images : [];
      const main = images.find((img) => img?.main) ?? images[0];
      return {
        id: String(doc._id),
        name: doc.name ?? '',
        image: main?.url ?? null,
      };
    });
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
      partNumberKey: normalizeCode(partNumber),
      $or: brandConditions,
    });
    if (!doc) return null;
    return this.productRepository.findByIdClean(doc.id);
  }

  async findAllModels(): Promise<ProductModel[]> {
    return this.productRepository.findAllClean({}, { limit: 0 });
  }

  @ValidateMongoId()
  async getProductCompletion(id: string, storeId?: string) {
    // Source of truth: always compute on read. Persisted `completion.*` fields
    // were a cache that drifted whenever product data was mutated through a
    // path that didn't emit a section-saved event (imports, discovery direct
    // writes, scripts). The compute is cheap (~5ms) and idempotent.
    const product = await this.productRepository.findByIdClean(id);
    if (!product) throw new NotFoundException('Produto não encontrado');

    // Itens gerais (saúde/beleza/alimentos) têm regra de completude própria —
    // não têm partNumber, títulos por marketplace nem dimensões obrigatórias.
    const computed = (product as any).domain === 'general'
      ? await this.computeGeneralCompletion(id, product, storeId)
      : await this.productReadinessService.compute(id, storeId);
    if (!computed) throw new NotFoundException('Produto não encontrado');

    const compatibilitiesComplete = await this.productRepository.existsCompatibility({ product: id });

    return {
      ...computed,
      compatibilities: compatibilitiesComplete,
    };
  }

  /**
   * Completude de um produto 'general', mapeada para as MESMAS chaves que o
   * frontend lê (data/images/titles/category/inventory/dimensions). Seções que
   * não se aplicam a itens gerais (titles/dimensions) não bloqueiam → true.
   * inventory exige preço > 0 E estoque > 0 (igual autopeças), com estoque
   * vindo da agregação de stock_movements (fonte única).
   */
  private async computeGeneralCompletion(id: string, product: any, storeId?: string) {
    const brandObj = product.brand || product.brands;
    // No general a marca costuma vir como atributo BRAND (de marketplace), não
    // no relacionamento brand do produto.
    const brandAttr = Array.isArray(product.attributes)
      ? product.attributes.find((a: any) => (a.code || a.id) === 'BRAND' && a.value)
      : null;
    const hasBrand = !!brandObj?.name || !!brandObj?.shortName || !!brandAttr;
    const data = !!(product.name && String(product.name).trim()) && hasBrand;

    const images = Array.isArray(product.images) && product.images.length > 0;
    const category = !!product.category;

    // Estoque store-aware (mesmo critério de ProductReadinessService.compute): com storeId
    // (usuário logado), lê exatamente essa loja, sem fallback. Sem storeId (chamadores sem
    // usuário), cai na primeira loja com StoreListing — comportamento anterior preservado.
    const resolvedStoreId = storeId ?? (await this.storeListingPort.findAnyByProduct(id))?.storeId;
    const stockQty = resolvedStoreId
      ? (await this.storeListingPort.getStockSummary(id, String(resolvedStoreId))).onHand
      : 0;
    const priceRaw = await this.pricing.getBasePrice(id);
    const inventory = stockQty > 0 && priceRaw > 0;

    // Títulos por marketplace são EXIGIDOS para general também (mesmo fluxo de
    // autopeças): só conclui com pelo menos um título e bloqueia readyToPublish.
    // Store-aware igual a ProductReadinessService.compute: com storeId, só a própria loja
    // conta — senão "done" aparece mesmo com a tela de Títulos vazia para esta loja.
    const titlesList = storeId
      ? await this.productTitleService.findByProductIdAndStore(id, storeId)
      : await this.productTitleService.findByProductId(id);
    const titles = Array.isArray(titlesList) && titlesList.length > 0;

    // Dimensões não se aplicam a itens gerais — não devem reprovar a publicação.
    const dimensions = true;

    const readyToPublish = data && images && titles && category && inventory;

    return { data, images, titles, category, inventory, dimensions, readyToPublish };
  }

  async findForStore(page = 1, limit = 20, search?: string, featured?: boolean) {
    const query: any = { active: true }; // status changed to active in schema

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ name: regex }, { partNumberKey: normalizeCode(search) }, { oemCodesKeys: normalizeCode(search) }];
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
    const pid = product.id || (product as any)._id.toString();
    return (await this.stockQuery.getProductStock(pid)).onHand;
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

    // 2. Cost = weighted-average lot cost (single source of truth = StockModule).
    const costPrice = await this.stockQuery.getProductCost(String(productDoc.id || productDoc._id));

    // 2b. Sale price = PricingModule (single source of truth). Per-marketplace override
    // when a marketplace is provided, otherwise the base price. NEVER cost.
    const salePrice = await this.pricing.getEffectivePrice(
      String(productDoc.id || productDoc._id),
      marketplace ? String(marketplace.id || marketplace._id) : undefined,
    );

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
      price: salePrice ?? 0,
      costPrice,
      quantity: available_quantity, // TRUSTED STOCK
      stock: available_quantity,    // Standard alias
      available_quantity,           // Standard alias
      marketplaceDescription,       // Expose generated description
      productMovements: [], // cost/stock now come from StockModule; adapters must not read movements here
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

    // Movement history from the stock ledger (read side)
    const movements = await this.stockQuery.listMovements(String(product._id), 200);

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
    const query: any = { partNumberKey: normalizeCode(partNumber), 'brand._id': brandId };

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
    return this.stockQuery.referenceExists(reference);
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

        return updated;
      }

      // Create New
      const shortTitle = data.title
        ? await this.productShortTitleService.createOrGet(data.title)
        : null;

      const slugBase = await buildUniqueProductSlug(
        {
          titleText: shortTitle?.text,
          subtitle: data.subtitle,
          name: data.name,
          brandShortName: data.brand?.shortName,
          partNumber: data.partNumber,
        },
        async (candidate) => !!(await this.productRepository.findOneRaw({ slug: candidate })),
      );

      const newProductData = {
        name: data.name || data.partNumber,
        partNumber: data.partNumber,
        createdByUserId: toOptionalObjectId(userId),
        slug: slugBase,
        description: data.description,
        titleId: shortTitle ? new Types.ObjectId(shortTitle._id) : undefined,
        subtitle: data.subtitle,
        titleText: shortTitle?.text,
        titleSynonyms: shortTitle?.synonyms,
        tax: {
          ncm: data.ncm,
          cfop: data.cfop,
          csosn: data.csosn,
          cest: data.cest,
          origin: data.origin
        },
        price: data.price ? Types.Decimal128.fromString(data.price.toString()) : Types.Decimal128.fromString('0'),
        // cost is no longer stored on the product — it lives on the stock lot (enters via inbound)
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

      // Sale price is owned by PricingModule (base price). Set it via the port on create.
      if (data.price !== undefined && data.price !== null) {
        await this.pricing.setBasePrice(String((savedProduct as any).id ?? (savedProduct as any)._id), Number(data.price));
      }
      const createdProductId = String((savedProduct as any).id ?? (savedProduct as any)._id);
      if (data.pricing) {
        await this.pricing.setPricingMeta(createdProductId, {
          markup: data.pricing?.markup,
          profitMargin: data.pricing?.profitMargin,
          strategy: data.pricing?.strategy,
        });
      }
      const createBasePrice = data.price !== undefined && data.price !== null ? Number(data.price) : 0;
      if (data.listPrice !== undefined && data.listPrice !== null && Number(data.listPrice) > createBasePrice) {
        await this.pricing.setPromotion(createdProductId, {
          listPrice: Number(data.listPrice),
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }

      const newProductClean = await this.productRepository.findByIdClean((savedProduct as any).id);

      // Update Category Counts
      if (newProductClean.category) {
        this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on create: ${e.message}`));
      }

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

      try {
        this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.DATA_SAVED, new ProductDataSavedEvent(savedProduct.id || savedProduct._id.toString()));
      } catch {}

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

    try {
      this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.DIMENSIONS_SAVED, new ProductDimensionsSavedEvent(id));
    } catch {}
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
      let newShortTitle: { _id: unknown; text: string; synonyms: string[] } | null = null;
      if (data.title) {
        newShortTitle = await this.productShortTitleService.createOrGet(data.title);
        product.titleId = new Types.ObjectId(String(newShortTitle._id));
        product.titleText = newShortTitle.text;
        product.titleSynonyms = newShortTitle.synonyms;
      }
      if (data.subtitle !== undefined) product.subtitle = data.subtitle;
      if (data.partNumber) product.partNumber = data.partNumber;
      if (data.description) product.description = data.description;
      if (data.details) product.details = data.details;
      if (data.active !== undefined) product.active = data.active;
      if (data.isGenuine !== undefined) product.isGenuine = data.isGenuine;

      // Produto universal é elegível em qualquer busca por veículo sem vínculo
      // granular (ver ProductVehicleSearchService) — compatibilidades específicas
      // salvas ficam redundantes/inconsistentes ao ativar, então são removidas
      // junto (confirmação já ocorreu na UI antes de chegar aqui).
      let removedCompatibilitiesCount: number | undefined;
      if (data.isUniversalFit !== undefined) {
        product.isUniversalFit = data.isUniversalFit;
        if (data.isUniversalFit) {
          removedCompatibilitiesCount = await this.productCompatibilityService.deleteAllForProduct(String(product._id));
        }
      }

      if (data.barcode !== undefined) product.barcode = data.barcode;
      if (data.oemCodes) product.oemCodes = data.oemCodes;
      if (data.applicationSummary) product.applicationSummary = data.applicationSummary;

      // Sale price is owned by PricingModule — route to the port (not the product doc).
      if (data.price !== undefined) await this.pricing.setBasePrice(String(product._id), Number(data.price));
      if (data.pricing) {
        await this.pricing.setPricingMeta(String(product._id), {
          markup: data.pricing?.markup,
          profitMargin: data.pricing?.profitMargin,
          strategy: data.pricing?.strategy,
        });
      }
      if (data.listPrice !== undefined) {
        const currentBasePrice =
          data.price !== undefined ? Number(data.price) : await this.pricing.getBasePrice(String(product._id));
        if (data.listPrice === null || Number(data.listPrice) <= currentBasePrice) {
          // App antigo envia listPrice <= preço base (ex: 0 ou igual ao price) para indicar "sem promoção".
          await this.pricing.clearPromotion(String(product._id));
        } else {
          await this.pricing.setPromotion(String(product._id), {
            listPrice: Number(data.listPrice),
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });
        }
      }
      // cost is owned by the stock lot (enters via inbound) — not persisted on the product
      if (data.weight !== undefined) product.weight = Types.Decimal128.fromString(data.weight.toString());

      if (data.dimensions) {
        product.dimensions = {
          length: Types.Decimal128.fromString(data.dimensions.length?.toString() || '0'),
          width: Types.Decimal128.fromString(data.dimensions.width?.toString() || '0'),
          height: Types.Decimal128.fromString(data.dimensions.height?.toString() || '0')
        };
      }

      const oldCategoryId = product.category ? String(product.category) : null;
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

      if (
        newShortTitle &&
        shouldRegenerateSlugForTitle({
          currentSlug: product.slug,
          name: product.name,
          brandShortName: product.brand?.shortName,
          partNumber: product.partNumber,
          barcode: product.barcode,
          newTitleText: newShortTitle.text,
        })
      ) {
        product.slug = await buildUniqueProductSlug(
          {
            titleText: newShortTitle.text,
            subtitle: product.subtitle,
            name: product.name,
            brandShortName: product.brand?.shortName,
            partNumber: product.partNumber,
            barcode: product.barcode,
          },
          async (candidate) => !!(await this.productRepository.findOneRaw({ slug: candidate, _id: { $ne: product._id } })),
        );
      }

      const updatedProduct = await this.productRepository.save(product);

      // REMOVED: Manual Publication Trigger (Handled by ProductWatcherService)

      // Update Category Counts if relevant fields changed
      if (data.category || data.active !== undefined) {
        this.productCategoryService.updateProductCounts().catch(e => this.logger.error(`Failed to update product counts on update: ${e.message}`));
      }

      // Alimenta a base de aprendizado titleId -> categoria (ver
      // docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md). Usa
      // product.titleId (já reflete tanto um title novo nesta chamada quanto um
      // titleId salvo anteriormente) — não exige mais que title e category cheguem
      // juntos no mesmo payload, que é o caso raro; o normal é o app salvá-los em
      // telas/momentos separados.
      if (product.titleId && data.category) {
        const newCategoryId = String(data.category.id || data.category);
        this.titleCategoryHintService.recordHint(String(product.titleId), newCategoryId)
          .catch(e => this.logger.error(`Failed to record category hint: ${e.message}`));

        // Categoria trocada (não só confirmada de novo) — invalida o hint antigo pra
        // não continuar sugerindo uma categoria que o usuário acabou de corrigir.
        if (oldCategoryId && oldCategoryId !== newCategoryId) {
          this.titleCategoryHintService.invalidateHint(String(product.titleId), oldCategoryId)
            .catch(e => this.logger.error(`Failed to invalidate old category hint: ${e.message}`));
        }
      }

      const clean = await this.productRepository.findByIdClean(updatedProduct.id);

      // Emit product.updated so async listeners can react to field changes
      const changedFields: string[] = [];
      if (data.weight !== undefined) changedFields.push('weight');
      if (data.dimensions !== undefined) changedFields.push('dimensions');

      if (changedFields.length > 0) {
        this.eventEmitter.emit(
          PRODUCT_EVENTS.UPDATED,
          new ProductUpdatedEvent(id, changedFields, {
            weight: data.weight !== undefined ? Number(data.weight) : undefined,
            dimensions: data.dimensions
              ? {
                  height: Number(data.dimensions.height),
                  width:  Number(data.dimensions.width),
                  length: Number(data.dimensions.length),
                }
              : undefined,
          }),
        );
      }

      try {
        this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.DATA_SAVED, new ProductDataSavedEvent(id));
      } catch {}

      if (removedCompatibilitiesCount !== undefined) {
        (clean as any).removedCompatibilitiesCount = removedCompatibilitiesCount;
      }

      return clean;
    } catch (error) {
      this.logger.error('Erro ao atualizar produto:', error);
      throw error;
    }
  }

  /** Mark a reserved image slot as failed (atomic positional update by slotId). */
  async markImageSlotFailed(productId: string, slotId: string): Promise<void> {
    await this.productRepository.markImageSlotFailed(productId, slotId);
  }

  /** Mark an existing image slot as processing (atomic positional update by slotId). */
  async markImageSlotProcessing(productId: string, slotId: string): Promise<void> {
    await this.productRepository.markImageSlotProcessing(productId, slotId);
  }

  @ValidateMongoId()
  async updateImages(id: string, imageDataList: {
    slotId?: string;
    url: string;
    key: string;
    filename?: string;
    mimeType?: string;
    /** Position in the list = source of truth for order. Falls back to array index. */
    order?: number;
    main?: boolean;
    /** 'active' | 'processing' | 'failed'. Defaults to 'active'. */
    status?: string;
  }[]): Promise<ProductModel> {
    try {
      const product = await this.findDocument(id);
      if (!product) {
        throw new NotFoundException(`Produto com ID ${id} não encontrado`);
      }

      // Persist order/main EXACTLY as the caller arranged them — never re-derive.
      product.images = imageDataList.map((img, index) => ({
        slotId: img.slotId,
        url: img.url,
        key: img.key,
        originalName: img.filename || `image-${index}`,
        mimeType: img.mimeType,
        main: img.main ?? index === 0,
        order: img.order ?? index,
        status: img.status ?? 'active'
      }));

      const updatedProduct = await this.productRepository.save(product);

      this.logger.log(`[DEBUG] ProductService.updateImages: Save complete for ${id}. ID: ${updatedProduct._id}`);

      try {
        this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.IMAGES_SAVED, new ProductImagesSavedEvent(id));
      } catch {}

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
  }[], userId?: number, storeId?: string | null): Promise<ProductModel> {
    try {
      // FIXED: Delegate to ProductTitleService which has proper externalId preservation and deduplication
      // The old implementation was naively replacing the entire titles array and setting externalId: null
      // This caused the watcher to treat all titles as new, creating duplicate products in marketplaces

      await this.productTitleService.updateTitles(id, titleDataList, userId, storeId);

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

    try {
      this.eventEmitter.emit(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED, new ProductCategorySavedEvent(id));
    } catch {}

    return this.productRepository.findByIdClean(saved.id);
  }


  @ValidateMongoId()
  async createMovement(productId: string, movementData: any): Promise<any> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      return this.stockService.move({
        productId: String(product._id),
        type: resolveMovementType(movementData.type),
        quantity: movementData.quantity,
        unitCost: movementData.costPrice ?? movementData.price,
        reason: movementData.reason,
        reference: movementData.reference,
        condition: resolveMovementCondition(movementData.condition, movementData.conditionId) as any,
        toBoxId: movementData.boxId ? String(movementData.boxId) : undefined,
        origin: movementData.origin,
        orderId: movementData.orderId,
      });
    } catch (error) {
      this.logger.error('Erro ao criar movimento:', error);
      throw error;
    }
  }

  @ValidateMongoId()
  async updateMovement(productId: string, movementId: string, movementData: any): Promise<any> {
    try {
      // Ledger is append-only: a quantity correction creates a compensating adjustment.
      const updatedMovement = movementData.quantity != null
        ? await this.stockService.editMovementViaAdjustment(movementId, movementData.quantity)
        : { message: 'Nada a corrigir.' };

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
    return this.stockQuery.listMovements(String(product._id), 200);
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
      mlVehicleId?: string;
      name?: string;
    }>
  ): Promise<{ compatibilities: any[]; mlSync: any }> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      // Adicionar um vínculo específico é sinal claro de que o produto não é mais
      // universal (isUniversalFit) — desliga automaticamente em vez de deixar os
      // dois estados coexistirem de forma inconsistente. Ver ProductService.update.
      if ((product as any).isUniversalFit) {
        await this.productRepository.update(String(product._id), { $set: { isUniversalFit: false } });
      }

      const compatibilities = await this.productCompatibilityService.createMultipleCompatibilitiesBatch({
        productId: String(product._id),
        vehicleIds,
        vehicleDetails
      });

      const mlSync = await this.autoSyncCompatibilitiesWithMercadoLivre(product, vehicleIds, compatibilities);

      return { compatibilities, mlSync };
    } catch (error) {
      this.logger.error('Erro ao adicionar compatibilidades ao produto:', error);
      throw error;
    }
  }

  /**
   * Best-effort: tenta enviar as compatibilidades recém-salvas ao Mercado Livre.
   * NUNCA lança — o salvamento local já é o dado de verdade; falha de rede/API do ML
   * aqui não pode reverter nem bloquear a resposta do endpoint de salvar.
   * Pula silenciosamente se o produto ainda não tem título publicado no ML (nada para enviar).
   */
  private async autoSyncCompatibilitiesWithMercadoLivre(
    product: any,
    requestedVehicleIds: string[],
    savedCompatibilities: any[],
  ): Promise<{ attempted: boolean; reason?: string; successCount?: number; errorCount?: number }> {
    try {
      const marketplace = await this.marketplaceRegistry.findByName('Mercado Livre');
      if (!marketplace) return { attempted: false, reason: 'marketplace_not_configured' };

      const resolvedMarketplaceId = String(marketplace._id);
      const allTitles = await this.productTitleService.findByProductId(product._id);
      const productTitles = allTitles.filter((title: any) => String(title.marketplaceId) === resolvedMarketplaceId);

      if (productTitles.length === 0) {
        return { attempted: false, reason: 'no_ml_title' };
      }

      const relevant = savedCompatibilities.filter((c: any) => requestedVehicleIds.includes(c.vehicleId));
      const mlVehicleIds = [...new Set(relevant.map((c: any) => c.mlVehicleId).filter(Boolean))] as string[];

      if (mlVehicleIds.length === 0) {
        return { attempted: false, reason: 'no_ml_vehicle_ids' };
      }

      const syncResult = await this.pushCompatibilitiesToMercadoLivre(productTitles, mlVehicleIds);

      if (syncResult.successCount > 0) {
        const syncedInternalIds = relevant
          .filter((c: any) => mlVehicleIds.includes(c.mlVehicleId))
          .map((c: any) => String(c._id ?? c.id))
          .filter(Boolean);
        await this.productCompatibilityService.markAsSynced(syncedInternalIds);
      }

      return { attempted: true, ...syncResult };
    } catch (error: any) {
      this.logger.warn(`Auto-sync de compatibilidades com Mercado Livre falhou (não bloqueante): ${error?.message}`);
      return { attempted: true, reason: 'error', successCount: 0, errorCount: requestedVehicleIds.length };
    }
  }

  /**
   * Núcleo de envio ao ML compartilhado entre o auto-sync e a sincronização direta manual.
   * O endpoint é aditivo (confirmado ao vivo contra a API — chamadas separadas ou em lote
   * só acrescentam, nunca substituem), mas tem um teto rígido de 200 produtos por
   * requisição (confirmado ao vivo: 201 numa chamada só dá 400 "Maximum of 200 products
   * for a single request was exceeded"). Chunka em blocos de até 200 — o mínimo de
   * chamadas que respeita o limite real da API, não um chunking arbitrário.
   */
  private static readonly ML_COMPATIBILITY_CHUNK_SIZE = 200;

  private async pushCompatibilitiesToMercadoLivre(
    productTitles: any[],
    vehicleIds: string[],
  ): Promise<{ successCount: number; errorCount: number; results: any[] }> {
    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    const chunkSize = ProductService.ML_COMPATIBILITY_CHUNK_SIZE;
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
          const resp = await this.mercadoLivreCompatibilityAdapter.syncCompatibility(title.externalId, payloadML);
          results.push({ title: title.title, itemId: title.externalId, status: 'success', count: chunk.length, response: resp });
          successCount += chunk.length;
        } catch (err: any) {
          this.logger.warn(`syncCompatibility falhou item=${title.externalId} count=${chunk.length}: ${err?.message}`);
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

    return { successCount, errorCount, results };
  }

  /**
   * Best-effort: remove do ML as compatibilidades (por mlVehicleId) já removidas
   * localmente. Direto (sem fila) — mesma justificativa do auto-sync de adição:
   * o dado de verdade é o local, e uma falha de rede aqui não deve bloquear a
   * remoção que o usuário já pediu.
   */
  private async removeCompatibilitiesFromMercadoLivre(product: any, removed: any[]): Promise<void> {
    const mlVehicleIds = [...new Set(removed.map((c: any) => c.mlVehicleId).filter(Boolean))] as string[];
    if (mlVehicleIds.length === 0) return;

    try {
      const marketplace = await this.marketplaceRegistry.findByName('Mercado Livre');
      if (!marketplace) return;

      const resolvedMarketplaceId = String(marketplace._id);
      const allTitles = await this.productTitleService.findByProductId(product._id);
      const productTitles = allTitles.filter((title: any) => String(title.marketplaceId) === resolvedMarketplaceId);

      for (const title of productTitles) {
        if (!title.externalId) continue;
        for (const mlVehicleId of mlVehicleIds) {
          try {
            await this.mercadoLivreCompatibilityAdapter.removeCompatibilityFromMarketplace(title.externalId, mlVehicleId);
          } catch (err: any) {
            this.logger.warn(
              `removeCompatibilityFromMarketplace falhou item=${title.externalId} mlVehicleId=${mlVehicleId}: ${err?.message}`,
            );
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Remoção de compatibilidades no Mercado Livre falhou (não bloqueante): ${error?.message}`);
    }
  }

  @ValidateMongoId(0) // Validate productId
  async removeProductCompatibility(productId: string, compatibilityId: string): Promise<void> {
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      const removed = await this.productCompatibilityService.deleteCompatibility(compatibilityId);
      if (removed) await this.removeCompatibilitiesFromMercadoLivre(product, [removed]);

      this.logger.log(`Compatibilidade ${compatibilityId} removida do produto ${productId}`);
    } catch (error) {
      this.logger.error('Erro ao remover compatibilidade:', error);
      throw error;
    }
  }

  /** Remove várias compatibilidades de uma vez (uma exclusão em lote + remoção direta no ML). */
  @ValidateMongoId(0)
  async removeProductCompatibilities(productId: string, compatibilityIds: string[]): Promise<void> {
    if (!compatibilityIds?.length) return;
    try {
      const product = await this.findOne(productId);
      if (!product) throw new NotFoundException(`Produto com ID ${productId} não encontrado`);

      const removed = await this.productCompatibilityService.deleteMultipleCompatibilities(compatibilityIds);
      if (removed.length > 0) await this.removeCompatibilitiesFromMercadoLivre(product, removed);

      this.logger.log(`${compatibilityIds.length} compatibilidade(s) removida(s) do produto ${productId}`);
    } catch (error) {
      this.logger.error('Erro ao remover compatibilidades em lote:', error);
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

      // Preparar dados para sincronização (usa o id da taxonomia ML, não o _id da base própria)
      const syncData = {
        itemIds: productTitles.filter(t => t.externalId).map(t => t.externalId),
        compatibilityIds: compatibilities.map(c => (c as any).mlVehicleId ?? c.vehicleId)
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

      const { successCount, errorCount, results } = await this.pushCompatibilitiesToMercadoLivre(productTitles, vehicleIds);

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
        const brand = comp.vehicle?.make || 'Não especificada';
        acc[brand] = (acc[brand] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estatísticas por ano
      const yearStats = compatibilities.reduce((acc, comp) => {
        const years: number[] = comp.vehicle?.years ?? [];
        const year = years.length ? String(Math.max(...years)) : 'Não especificado';
        acc[year] = (acc[year] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estatísticas por combustível
      const fuelStats = compatibilities.reduce((acc, comp) => {
        const fuel = comp.vehicle?.fuelType || 'Não especificado';
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
        { partNumberKey: normalizeCode(query) },
        { oemCodesKeys: normalizeCode(query) },
        { name: new RegExp(query, 'i') },
        { 'brand.name': new RegExp(query, 'i') }
      ],
      active: true
    }, {
      limit: 20,
      sort: { updatedAt: -1 }
    });
  }

  async createFromDiscovery(dto: CreateFromDiscoveryDto, userId?: string): Promise<ProductModel> {
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
    const slugBase = await buildUniqueProductSlug(
      { name: discoveryData.name, brandShortName: (brand as any).shortName, partNumber: dto.partNumber },
      async (candidate) => !!(await this.productRepository.findOneRaw({ slug: candidate })),
    );

    // 5. Cria o produto com campos pré-preenchidos
    const created = await this.productRepository.create({
      name: discoveryData.name || dto.partNumber,
      slug: slugBase,
      partNumber: dto.partNumber,
      createdByUserId: toOptionalObjectId(userId),
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

    return result;
  }
}
