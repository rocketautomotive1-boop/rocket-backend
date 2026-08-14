import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { ProductVehicleSearchService } from './product-vehicle-search.service';
import { CategoryLookupService } from './category-lookup.service';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';

export type ProductRailType =
  | 'universal'
  | 'best-sellers'
  | 'for-your-car'
  | 'accessories-for-your-car'
  | 'deals';

const RAIL_TYPES: ProductRailType[] = [
  'universal',
  'best-sellers',
  'for-your-car',
  'accessories-for-your-car',
  'deals',
];

const ACCESSORIES_CATEGORY_SLUG = 'acessorios';

interface RailOptions {
  vehicleId?: string;
  limit?: number;
}

/**
 * ProductModel + price/listPrice (join em lote com PricingModule) + stockQuantity (join em
 * lote com StockModule) — nenhum dos dois é campo do schema desde o refactor de
 * pricing/stock em módulos próprios.
 */
export type ProductRailItem = ProductModel & { price: number; listPrice?: number; stockQuantity: number };

/**
 * Rails de recomendação da home do rocket-b2c (universal/best-sellers/for-your-car/
 * accessories-for-your-car), ordenados por ProductModel.relevanceScore. Ver
 * docs/superpowers/specs/2026-07-13-product-relevance-rails-design.md.
 */
@Injectable()
export class ProductRailsService {
  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(CategoryModel.name) private readonly categoryModel: Model<CategoryDocument>,
    private readonly vehicleSearchService: ProductVehicleSearchService,
    private readonly categoryLookupService: CategoryLookupService,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
  ) {}

  async getRail(railType: ProductRailType, options: RailOptions = {}): Promise<ProductRailItem[]> {
    if (!RAIL_TYPES.includes(railType)) {
      throw new BadRequestException(`railType inválido: ${railType}`);
    }

    const limit = options.limit ?? 20;
    const products = await this.fetchRail(railType, options, limit);
    return this.attachPricesAndStock(products);
  }

  private async fetchRail(railType: ProductRailType, options: RailOptions, limit: number): Promise<any[]> {
    switch (railType) {
      case 'universal':
        return this.productModel
          .find({ active: true, isUniversalFit: true })
          .sort({ relevanceScore: -1 })
          .limit(limit)
          .lean()
          .exec();

      case 'best-sellers':
        return this.productModel
          .find({ active: true })
          .sort({ relevanceScore: -1 })
          .limit(limit)
          .lean()
          .exec();

      case 'for-your-car':
        return this.getForYourCar(options, limit);

      case 'accessories-for-your-car':
        return this.getAccessoriesForYourCar(options, limit);

      case 'deals':
        return this.getDeals(limit);
    }
  }

  private async getDeals(limit: number): Promise<any[]> {
    const productIds = await this.pricing.getActivePromotionProductIds();
    if (productIds.length === 0) return [];

    const validIds = productIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    return this.productModel
      .find({ active: true, _id: { $in: validIds } } as any)
      .sort({ relevanceScore: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Preço vive no PricingModule, estoque no StockModule — nenhum dos dois em ProductModel
   * (produtos cadastrados antes das respectivas migrações podem ter campos órfãos no
   * documento, mas o storefront deve sempre ler ao vivo). Join em lote, em paralelo.
   */
  private async attachPricesAndStock(products: any[]): Promise<ProductRailItem[]> {
    if (products.length === 0) return [];
    const ids = products.map((p) => String(p._id));
    const [pricingById, availableById] = await Promise.all([
      this.pricing.getPricings(ids),
      this.stockQuery.getAvailableBulk(ids),
    ]);
    return products.map((p) => {
      const pricing = pricingById.get(String(p._id));
      return {
        ...p,
        price: pricing?.basePrice ?? 0,
        listPrice: pricing?.listPrice,
        stockQuantity: availableById.get(String(p._id)) ?? 0,
      };
    });
  }

  private requireVehicleId(options: RailOptions): string {
    if (!options.vehicleId) {
      throw new BadRequestException('vehicleId é obrigatório para este railType');
    }
    return options.vehicleId;
  }

  private async getForYourCar(options: RailOptions, limit: number): Promise<any[]> {
    const vehicleId = this.requireVehicleId(options);
    const accessoriesCategoryId = await this.categoryLookupService.resolveIdBySlug(ACCESSORIES_CATEGORY_SLUG);

    // Sobre-busca (limit*2) porque o filtro por categoria reduz o conjunto depois de já
    // vir ordenado/paginado pelo findByVehicle — evita subestimar o rail em veículos com
    // muitos acessórios compatíveis.
    const { data } = await this.vehicleSearchService.findByVehicle({ vehicleId, limit: limit * 2 });
    if (!accessoriesCategoryId) return this.sortByRelevance(data).slice(0, limit);

    const inAccessoriesSubtree = await this.categoryIdsInSubtree(accessoriesCategoryId, data);
    const filtered = data.filter((p: any) => !inAccessoriesSubtree.has(this.extractCategoryId(p.category)));

    return this.sortByRelevance(filtered).slice(0, limit);
  }

  private async getAccessoriesForYourCar(options: RailOptions, limit: number): Promise<any[]> {
    const vehicleId = this.requireVehicleId(options);
    const accessoriesCategoryId = await this.categoryLookupService.resolveIdBySlug(ACCESSORIES_CATEGORY_SLUG);
    if (!accessoriesCategoryId) return [];

    const { data } = await this.vehicleSearchService.findByVehicle({ vehicleId, limit: limit * 2 });
    const inAccessoriesSubtree = await this.categoryIdsInSubtree(accessoriesCategoryId, data);
    const filtered = data.filter((p: any) => inAccessoriesSubtree.has(this.extractCategoryId(p.category)));

    return this.sortByRelevance(filtered).slice(0, limit);
  }

  private extractCategoryId(category: any): string | undefined {
    if (!category) return undefined;
    if (typeof category === 'string') return category;
    if (category._id) return String(category._id);
    if (category instanceof Types.ObjectId) return category.toString();
    return undefined;
  }

  /**
   * Dado o _id da categoria raiz "Acessórios", resolve quais categorias distintas presentes
   * em `products` pertencem à subárvore dela (a própria categoria ou tendo-a em `ancestors`).
   */
  private async categoryIdsInSubtree(rootCategoryId: Types.ObjectId, products: any[]): Promise<Set<string>> {
    const categoryIds = [
      ...new Set(products.map((p) => this.extractCategoryId(p.category)).filter((id): id is string => !!id)),
    ];
    if (categoryIds.length === 0) return new Set();

    const categories = await this.categoryModel
      .find({ _id: { $in: categoryIds } })
      .select('_id ancestors')
      .lean()
      .exec();

    const rootIdStr = String(rootCategoryId);
    const matched = new Set<string>();
    for (const c of categories as any[]) {
      const idStr = String(c._id);
      if (idStr === rootIdStr) {
        matched.add(idStr);
        continue;
      }
      const ancestors = (c.ancestors ?? []).map((a: any) => String(a));
      if (ancestors.includes(rootIdStr)) matched.add(idStr);
    }
    return matched;
  }

  private sortByRelevance(products: any[]): any[] {
    return [...products].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
  }
}
