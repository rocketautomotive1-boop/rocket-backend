import { Injectable, Logger } from '@nestjs/common';
import { ProductData, ProductDataPort } from '../ports';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { CategoryMappingService } from '../../marketplace/services/category/category-mapping.service';

const num = (v: any): number => {
  if (v == null) return 0;
  const n = Number(typeof v === 'object' && v.toString ? v.toString() : v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve, numa leitura, os dados do produto que o simulador precisa:
 * custo, categoria ML (via category.marketplaceMappings) e dimensões/peso.
 * Mantém o CostSimulationService desacoplado de Product/Category/Marketplace.
 */
@Injectable()
export class ProductDataAdapter implements ProductDataPort {
  private readonly logger = new Logger(ProductDataAdapter.name);
  private mlIdCache: string | null = null;

  constructor(
    private readonly productService: ProductService,
    private readonly marketplaceService: MarketplaceService,
    private readonly categoryMappingService: CategoryMappingService,
  ) {}

  // ── parsing puro (testável) ──
  /** Monta "CxLxA,pesoG" para shipping_options. null se faltar peso. */
  static buildDimensions(dimensions: any, weightKgOrG: number): string | null {
    if (!weightKgOrG || weightKgOrG <= 0) return null;
    // weight no schema é Decimal128 em kg (padrão ML usa g no shipping_options) — normalizamos p/ g.
    const grams = weightKgOrG < 50 ? Math.round(weightKgOrG * 1000) : Math.round(weightKgOrG);
    const L = Math.round(num(dimensions?.length)) || 20;
    const W = Math.round(num(dimensions?.width)) || 15;
    const H = Math.round(num(dimensions?.height)) || 10;
    return `${L}x${W}x${H},${grams}`;
  }

  async getProductData(productId: string): Promise<ProductData> {
    let p: any = null;
    try {
      p = await this.productService.findOne(productId, { lean: true });
    } catch (e: any) {
      this.logger.warn(`Produto indisponível (${productId}): ${e.message}`);
      return { cost: 0, categoryId: null, dimensions: null };
    }
    if (!p) return { cost: 0, categoryId: null, dimensions: null };

    const cost = num(p.avgCost ?? p.costPrice ?? p.cost);
    const weight = num(p.weight);
    const dimensions = ProductDataAdapter.buildDimensions(p.dimensions, weight);

    let categoryId: string | null = null;
    try {
      const internalCat = p.category ? String(p.category?._id ?? p.category?.$oid ?? p.category) : null;
      if (internalCat) {
        const mlId = await this.mercadoLivreId();
        if (mlId) categoryId = await this.categoryMappingService.resolveCategory(internalCat, mlId);
      }
    } catch (e: any) {
      this.logger.warn(`Resolução de categoria ML falhou (${productId}): ${e.message}`);
    }

    return { cost, categoryId, dimensions };
  }

  private async mercadoLivreId(): Promise<string | null> {
    if (this.mlIdCache) return this.mlIdCache;
    const mp = await this.marketplaceService.findByName('Mercado Livre');
    this.mlIdCache = mp ? String(mp._id ?? mp.id) : null;
    return this.mlIdCache;
  }
}
