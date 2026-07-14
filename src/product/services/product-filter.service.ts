

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema'; // [NEW]
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { ProductService } from '../product.service';
import { ProductRepository } from '../product.repository';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { ProductVehicleSearchService } from './product-vehicle-search.service';
import {
  ProductFilterDto,
  PaginatedResponseDto,
  NumericRangeDto,
  DateRangeDto,
  BrandFilterDto,
  CategoryFilterDto,
  InventoryFilterDto,
  AttributeFilterDto,
  MarketplaceFilterDto,
  ImageFilterDto,
  SortDto,
  PaginationDto,
  CompatibilitySearchResponseDto
} from '../dto/product-filter.dto';

@Injectable()
export class ProductFilterService {
  private readonly logger = new Logger(ProductFilterService.name);

  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(CategoryModel.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @Inject(forwardRef(() => ProductService))
    private readonly productService: ProductService,
    @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
    private readonly productRepository: ProductRepository,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    private readonly productVehicleSearchService: ProductVehicleSearchService,
    @Inject(PRICING_PORT) private readonly pricingPort: PricingPort,
  ) { }

  async findProducts(filters: ProductFilterDto): Promise<PaginatedResponseDto<ProductModel>> {
    const query: any = { active: true };

    this.applyBasicFilters(query, filters);
    this.applyBrandFilters(query, filters.brand);
    await this.applyCategoryFilters(query, filters.category);
    await this.applyInventoryFilters(query, filters.inventory);
    await this.applyMarketplaceFilters(query, filters.marketplace);
    this.applyImageFilters(query, filters.images);
    this.applyAttributeFilters(query, filters.attributes);
    await this.applySearchFilter(query, filters.search);

    const sort = this.getSortOptions(filters);
    const page = filters.page || filters.pagination?.page || 1;
    const limit = filters.limit || filters.pagination?.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.productModel.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.productModel.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    // [REF] Populate titles from Listings if requested
    // Default is includeTitles=true if not specified? 
    // Filters says: includeTitles?: boolean.
    // Let's assume yes because UI probably needs it.
    if (filters.includeTitles !== false && data.length > 0) {
      const productIds = data.map(p => p._id);
      const listings = await this.listingModel.find({ productId: { $in: productIds } }).lean().exec();

      // Map listings to product.titles (legacy)
      data.forEach(p => {
        (p as any).titles = listings.filter(l => String(l.productId) === String(p._id));
      });
    }

    // price vive no PricingModule (product_pricing), não em ProductModel — join em lote pra
    // evitar N+1 e devolver o preço de fato pro consumidor da listagem.
    if (data.length > 0) {
      const priceById = await this.pricingPort.getBasePrices(data.map(p => String(p._id)));
      data.forEach(p => {
        (p as any).price = priceById.get(String(p._id)) ?? 0;
      });
    }

    // estoque vive no StockModule (ledger+lots), não em ProductModel — mesmo join em lote
    // usado por product-rails/product-vehicle-search, pra listagem não cair em "esgotado" à toa.
    if (data.length > 0) {
      const stockById = await this.stockQuery.getAvailableBulk(data.map(p => String(p._id)));
      data.forEach(p => {
        (p as any).stockQuantity = stockById.get(String(p._id)) ?? 0;
      });
    }

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  private applyBasicFilters(query: any, filters: ProductFilterDto): void {
    if (filters.ids && filters.ids.length > 0) {
      query._id = { $in: filters.ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id)) };
    }
    if (filters.mongoIds && filters.mongoIds.length > 0) {
      query._id = { $in: filters.mongoIds };
    }
    if (filters.name) {
      query.name = { $regex: filters.name, $options: 'i' };
    }
    if (filters.partNumber) {
      query.partNumber = filters.partNumber;
    }
    if (filters.gtin) {
      query.gtin = filters.gtin;
    }
    if (filters.status && filters.status.length > 0) {
      if ((filters.status as any).includes('active')) query.active = true;
      if ((filters.status as any).includes('inactive')) query.active = false;
    }
    if (filters.isGenuine !== undefined) {
      query['brand.isGenuine'] = filters.isGenuine;
    }
    if (filters.price) this.applyNumericRangeFilter(query, 'price', filters.price);
    if (filters.weight) this.applyNumericRangeFilter(query, 'weight', filters.weight);
    if (filters.createdAt) this.applyDateRangeFilter(query, 'createdAt', filters.createdAt);
    if (filters.updatedAt) this.applyDateRangeFilter(query, 'updatedAt', filters.updatedAt);
  }

  private applyBrandFilters(query: any, brandFilter?: BrandFilterDto): void {
    if (!brandFilter) return;
    if (brandFilter.ids?.length) {
      query['brand.id'] = { $in: brandFilter.ids };
    }
    if (brandFilter.names?.length) {
      query['brand.name'] = { $in: brandFilter.names.map(n => new RegExp(n, 'i')) };
    }
    if (brandFilter.shortNames?.length) {
      query['brand.shortName'] = { $in: brandFilter.shortNames };
    }
  }

  private async applyCategoryFilters(query: any, categoryFilter?: CategoryFilterDto): Promise<void> {
    if (!categoryFilter) return;
    if (categoryFilter.ids?.length) {
      query['category'] = { $in: categoryFilter.ids };
    }
    if (categoryFilter.names?.length) {
      const categories = await this.categoryModel.find({
        name: { $in: categoryFilter.names.map(n => new RegExp(n, 'i')) }
      }).select('_id');
      const categoryIds = categories.map(c => c._id);

      // Merge with existing category query if any
      if (query['category']) {
        query['category'].$in = [...(query['category'].$in || []), ...categoryIds];
      } else {
        query['category'] = { $in: categoryIds };
      }
    }
  }

  private async applyInventoryFilters(query: any, inventoryFilter?: InventoryFilterDto): Promise<void> {
    if (!inventoryFilter) return;
    if (inventoryFilter.hasStock) {
      const ids = await this.stockQuery.getProductIdsWithMinStock(1);
      query._id = { ...(query._id || {}), $in: ids };
    } else if (inventoryFilter.minStock !== undefined) {
      const ids = await this.stockQuery.getProductIdsWithMinStock(inventoryFilter.minStock);
      query._id = { ...(query._id || {}), $in: ids };
    }
  }

  private async applyMarketplaceFilters(query: any, marketplaceFilter?: MarketplaceFilterDto): Promise<void> {
    if (!marketplaceFilter) return;
    if (marketplaceFilter.ids?.length) {
      // [REF] Find products that have listings in these marketplaces
      const listings = await this.listingModel.find({
        marketplaceId: { $in: marketplaceFilter.ids as any[] } as any, // Cast to any to avoid TS mismatch if IDs are strings and model expects ObjectId
        status: 'active'
      }).select('productId').lean().exec();

      const productIds = listings.map(l => l.productId);

      if (query._id) {
        query._id.$in = query._id.$in ? query._id.$in.filter((id: any) => productIds.some(pid => String(pid) === String(id))) : productIds;
      } else {
        query._id = { $in: productIds };
      }
    }
  }

  private applyImageFilters(query: any, imageFilter?: ImageFilterDto): void {
    if (!imageFilter) return;
    if (imageFilter.hasImages) {
      query.images = { $exists: true, $not: { $size: 0 } };
    }
    if (imageFilter.minImages !== undefined) {
      query.$expr = { $gte: [{ $size: "$images" }, imageFilter.minImages] };
    }
  }

  private applyAttributeFilters(query: any, attributeFilters?: AttributeFilterDto[]): void {
    if (!attributeFilters?.length) return;
    attributeFilters.forEach(filter => {
      const elemMatch: any = {};
      if (filter.code) elemMatch.code = filter.code;
      if (filter.value) elemMatch.value = filter.value;

      if (Object.keys(elemMatch).length > 0) {
        if (!query.attributes) query.attributes = { $all: [] };
        query.attributes.$all.push({ $elemMatch: elemMatch });
      }
    });
  }

  private async applySearchFilter(query: any, search?: string): Promise<void> {
    if (!search) return;
    const regex = new RegExp(search, 'i');

    // Find matching categories
    const matchingCategories = await this.categoryModel.find({ name: regex }).select('_id');
    const categoryIds = matchingCategories.map(c => c._id);

    query.$or = [
      { name: regex },
      { partNumber: regex },
      { 'brand.name': regex },
      { category: { $in: categoryIds } },
    ];
  }

  private applyNumericRangeFilter(query: any, field: string, range?: NumericRangeDto): void {
    if (!range) return;
    const criterion: any = {};
    if (range.min !== undefined) criterion.$gte = range.min;
    if (range.max !== undefined) criterion.$lte = range.max;
    if (Object.keys(criterion).length > 0) query[field] = criterion;
  }

  private applyDateRangeFilter(query: any, field: string, range?: DateRangeDto): void {
    if (!range) return;
    const criterion: any = {};
    if (range.from) criterion.$gte = range.from;
    if (range.to) criterion.$lte = range.to;
    if (Object.keys(criterion).length > 0) query[field] = criterion;
  }

  private getSortOptions(filters: ProductFilterDto): any {
    const field = filters.sort?.field || filters.sortField || 'relevanceScore';
    const direction = (filters.sort?.direction || filters.sortDirection || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
    const fieldMap: any = {
      id: 'sku',
      name: 'name',
      price: 'price',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      relevanceScore: 'relevanceScore'
    };
    return { [fieldMap[field] || 'relevanceScore']: direction };
  }

  async findSimilarProductsByCompatibility(id: number, options: any): Promise<ProductModel[]> {
    return [];
  }

  /** Resumo de compatibilidade do produto — lido de compatibilitySummary (denormalizado). */
  async getProductCompatibilityStats(id: string): Promise<any> {
    const product = await this.productModel.findById(id).select('compatibilitySummary').lean().exec();
    const summary = (product as any)?.compatibilitySummary;
    if (!summary) return { total: 0, brands: [], models: [] };
    return {
      total: summary.vehicleCount ?? 0,
      brands: summary.makes ?? [],
      models: summary.models ?? [],
    };
  }

  /** Busca combinada produto+veículo em texto livre (ex.: "palheta toro 2025") — sem parsing determinístico. */
  async findProductsByCompatibilityKeywords(keywords: string, options: any): Promise<CompatibilitySearchResponseDto> {
    return this.productVehicleSearchService.searchByText(keywords, {
      page: options.page,
      limit: options.limit,
      brandNames: options.brandNames,
      categoryNames: options.categoryNames,
      priceMin: options.priceMin,
      priceMax: options.priceMax,
      vehicleId: options.vehicleId,
      sort: options.sort,
    });
  }

  async findProductsIntelligent(term: string, options: any): Promise<PaginatedResponseDto<ProductModel>> {
    // Product search runs entirely on MongoDB (Elasticsearch was removed).
    return this.findProducts({
      search: term,
      page: options.page,
      limit: options.limit,
      includeBrand: options.includeBrand,
      includeCategory: options.includeCategory,
      includeImages: options.includeImages,
      includeInventory: options.includeInventory,
      includeTitles: options.includeTitles,
    } as ProductFilterDto);
  }

  async findProductsByAttributes(attributes: any): Promise<ProductModel[]> {
    // Basic implementation: find products matching ALL attributes
    const query = { active: true };
    // ... logic
    return [];
  }

  async findLowStockProducts(threshold: number): Promise<ProductModel[]> {
    const lowStockIds = await this.stockQuery.getProductIdsWithMaxStock(threshold);
    return this.productModel.find({ _id: { $in: lowStockIds } as any }).lean().exec();
  }

  async findProductsWithoutImages(): Promise<ProductModel[]> {
    return this.productModel.find({ images: { $size: 0 } }).lean().exec();
  }

  async getProductStats(): Promise<any> {
    const total = await this.productModel.countDocuments();
    const active = await this.productModel.countDocuments({ active: true });
    const lowStockIds = await this.stockQuery.getProductIdsWithMaxStock(5);
    const lowStock = lowStockIds.length;
    const noImages = await this.productModel.countDocuments({ images: { $size: 0 } });
    return { total, active, lowStock, noImages };
  }
}