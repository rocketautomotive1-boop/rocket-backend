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
  /** Normaliza o peso do produto para kg. O schema guarda em kg (Decimal128);
   *  defensivo: valores absurdos (>1000) provavelmente vieram em gramas. */
  static normalizeWeightKg(rawWeight: number): number {
    if (!rawWeight || rawWeight <= 0) return 0;
    return rawWeight > 1000 ? rawWeight / 1000 : rawWeight;
  }

  async getProductData(productId: string): Promise<ProductData> {
    let p: any = null;
    try {
      p = await this.productService.findOne(productId, { lean: true });
    } catch (e: any) {
      this.logger.warn(`Produto indisponível (${productId}): ${e.message}`);
      return { cost: 0, categoryId: null, weightKg: 0 };
    }
    if (!p) return { cost: 0, categoryId: null, weightKg: 0 };

    const cost = num(p.avgCost ?? p.costPrice ?? p.cost);
    const weightKg = ProductDataAdapter.normalizeWeightKg(num(p.weight));

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

    return { cost, categoryId, weightKg };
  }

  private async mercadoLivreId(): Promise<string | null> {
    if (this.mlIdCache) return this.mlIdCache;
    const mp = await this.marketplaceService.findByName('Mercado Livre');
    this.mlIdCache = mp ? String(mp._id ?? mp.id) : null;
    return this.mlIdCache;
  }
}
