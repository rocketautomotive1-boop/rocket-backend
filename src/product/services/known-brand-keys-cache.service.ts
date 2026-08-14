import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CrossReferenceCodeModel, CrossReferenceCodeDocument } from '../schemas/cross-reference-code.schema';
import { normalizeBrand } from '../utils/code-key.util';

/**
 * Cache in-process (TTL, não write-through) do conjunto de marcas conhecidas —
 * união de `Product.brand.name` e `cross_reference_codes.brandKey`. Usado pela
 * busca de texto para detectar quando um token da query é provavelmente uma
 * marca (ver design doc 2026-07-24-search-engine-robustness-design.md, seção
 * 1 — compound-key marca+código), sem pagar uma ida ao Mongo por busca.
 *
 * TTL (não write-through como MarketplaceConfigCacheService) porque a fonte
 * muda por processo externo ao backend (import de catálogo, `brandKey`
 * chegando via `cross-reference.service.insertCode`) — não há um único
 * caminho de escrita que possamos interceptar pra invalidar ativamente.
 * ~150k+ produtos e ~580k cross_reference_codes hoje, mas o resultado é só o
 * conjunto DISTINCT de marcas (algumas centenas), então o custo é baixo mesmo
 * recalculado a cada TTL.
 */
@Injectable()
export class KnownBrandKeysCacheService {
  private readonly logger = new Logger(KnownBrandKeysCacheService.name);
  private readonly ttlMs = 10 * 60_000;

  private cache: Set<string> | null = null;
  private expiresAt = 0;
  private hydrating: Promise<Set<string>> | null = null;

  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(CrossReferenceCodeModel.name)
    private readonly codeModel: Model<CrossReferenceCodeDocument>,
  ) {}

  async has(brandKey: string): Promise<boolean> {
    if (!brandKey) return false;
    const set = await this.ensureHydrated();
    return set.has(brandKey);
  }

  private async ensureHydrated(): Promise<Set<string>> {
    if (this.cache && Date.now() < this.expiresAt) return this.cache;
    if (this.hydrating) return this.hydrating;

    this.hydrating = this.hydrate();
    try {
      this.cache = await this.hydrating;
      this.expiresAt = Date.now() + this.ttlMs;
      return this.cache;
    } finally {
      this.hydrating = null;
    }
  }

  private async hydrate(): Promise<Set<string>> {
    const [productBrandNames, crossRefBrandKeys] = await Promise.all([
      this.productModel.distinct('brand.name').exec(),
      this.codeModel.distinct('brandKey').exec(),
    ]);

    const set = new Set<string>();
    for (const name of productBrandNames as unknown as string[]) {
      if (name) set.add(normalizeBrand(name));
    }
    for (const key of crossRefBrandKeys as unknown as string[]) {
      if (key) set.add(key);
    }

    this.logger.debug(`Known brand keys hydrated: ${set.size}`);
    return set;
  }
}
