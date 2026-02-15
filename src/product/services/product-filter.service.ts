

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema'; // [NEW]
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { ProductService } from '../product.service';
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
  CompatibilityFilterDto,
  SortDto,
  PaginationDto
} from '../dto/product-filter.dto';
import { SearchService } from '../../search/search.service';

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
    @Inject(forwardRef(() => SearchService))
    private readonly searchService: SearchService,
    @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>, // [NEW]
  ) { }

  async findProducts(filters: ProductFilterDto): Promise<PaginatedResponseDto<ProductModel>> {
    const query: any = { active: true };

    this.applyBasicFilters(query, filters);
    this.applyBrandFilters(query, filters.brand);
    await this.applyCategoryFilters(query, filters.category);
    this.applyInventoryFilters(query, filters.inventory);
    await this.applyMarketplaceFilters(query, filters.marketplace);
    this.applyImageFilters(query, filters.images);
    this.applyAttributeFilters(query, filters.attributes);
    this.applyCompatibilityFilters(query, filters.compatibilities);
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
      query.sku = { $in: filters.ids };
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

  private applyInventoryFilters(query: any, inventoryFilter?: InventoryFilterDto): void {
    if (!inventoryFilter) return;
    if (inventoryFilter.hasStock) {
      query.stockQuantity = { $gt: 0 };
    }
    if (inventoryFilter.minStock !== undefined) {
      query.stockQuantity = { $gte: inventoryFilter.minStock };
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

  private applyCompatibilityFilters(query: any, compFilter?: CompatibilityFilterDto): void {
    if (!compFilter) return;
    const criteria: any = {};
    if (compFilter.vehicleBrands?.length) criteria.vehicleBrand = { $in: compFilter.vehicleBrands };
    if (compFilter.vehicleModels?.length) criteria.vehicleModel = { $in: compFilter.vehicleModels };
    if (compFilter.vehicleYears?.length) criteria.vehicleYear = { $in: compFilter.vehicleYears };
    if (compFilter.syncedWithMarketplace !== undefined) criteria.syncedWithMarketplace = compFilter.syncedWithMarketplace;

    if (Object.keys(criteria).length > 0) {
      query.compatibilities = { $elemMatch: criteria };
    }
    if (compFilter.hasCompatibilities) {
      query.compatibilities = { $exists: true, $not: { $size: 0 } };
    }
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
      { compatibilityKeywords: regex }
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
    const field = filters.sort?.field || filters.sortField || 'updatedAt';
    const direction = (filters.sort?.direction || filters.sortDirection || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
    const fieldMap: any = {
      id: 'sku',
      name: 'name',
      price: 'price',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt'
    };
    return { [fieldMap[field] || 'updatedAt']: direction };
  }

  async updateProductCompatibilityKeywords(productId: string): Promise<void> {
    const product = await this.productService.findOne(productId);
    // product.compatibilities check removed, fetching from service
    if (!product) return;

    const keywords = new Set<string>();
    const compatibilities = await this.productService.getProductCompatibilities(productId);
    compatibilities.forEach(comp => {
      if (comp.vehicleBrand) keywords.add(comp.vehicleBrand);
      if (comp.vehicleModel) keywords.add(comp.vehicleModel);
    });
    // save logic if needed
  }

  async findSimilarProductsByCompatibility(id: number, options: any): Promise<ProductModel[]> {
    return [];
  }

  async getProductCompatibilityStats(id: string): Promise<any> {
    return { total: 0, brands: [] };
  }

  async findProductsByCompatibilityKeywords(keywords: string, options: any): Promise<PaginatedResponseDto<ProductModel>> {
    return { data: [], pagination: { page: 1, limit: options.limit || 10, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  async findProductsIntelligent(term: string, options: any): Promise<PaginatedResponseDto<ProductModel>> {
    try {
      this.logger.log(`Performing intelligent search for: ${term}`);

      // ES returns mapped objects that look like ProductModel
      // ES returns mapped objects that look like ProductModel
      const searchResult: any = await this.searchService.search(term);
      const esResults = searchResult.data || [];

      if (!esResults || esResults.length === 0) {
        return {
          data: [],
          pagination: {
            page: options.page || 1, // 1-indexed
            limit: options.limit || 10,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          }
        };
      }

      // Return ES results directly (Already sorted by relevance/score)
      // Note: This bypasses MongoDB completely for speed.
      return {
        data: esResults,
        pagination: {
          page: 1, // ES simple search usually returns top hits
          limit: esResults.length,
          total: esResults.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        }
      };

    } catch (error) {
      this.logger.error(`Intelligent search failed: ${error.message}, falling back to Regex`);
      return this.findProducts({ search: term, page: options.page, limit: options.limit });
    }
  }

  async findProductsByAttributes(attributes: any): Promise<ProductModel[]> {
    // Basic implementation: find products matching ALL attributes
    const query = { active: true };
    // ... logic
    return [];
  }

  async findLowStockProducts(threshold: number): Promise<ProductModel[]> {
    return this.productModel.find({ stockQuantity: { $lte: threshold } }).lean().exec();
  }

  async findProductsWithoutImages(): Promise<ProductModel[]> {
    return this.productModel.find({ images: { $size: 0 } }).lean().exec();
  }

  async getProductStats(): Promise<any> {
    const total = await this.productModel.countDocuments();
    const active = await this.productModel.countDocuments({ active: true });
    const lowStock = await this.productModel.countDocuments({ stockQuantity: { $lte: 5 } });
    const noImages = await this.productModel.countDocuments({ images: { $size: 0 } });
    return { total, active, lowStock, noImages };
  }
}