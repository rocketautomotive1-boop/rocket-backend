import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';
import { PaginatedResponseDto, CompatibilitySearchResponseDto, SearchFacetsDto } from '../dto/product-filter.dto';
import { SearchResultCacheService } from './search-result-cache.service';

interface ByVehicleOptions {
  vehicleId?: string;
  make?: string;
  model?: string;
  page?: number;
  limit?: number;
}

interface ByTextOptions {
  page?: number;
  limit?: number;
  brandNames?: string[];
  categoryNames?: string[];
  priceMin?: number;
  priceMax?: number;
  vehicleId?: string;
  sort?: 'relevance' | 'price_asc' | 'price_desc';
}

/**
 * Busca de produtos pela direção inversa (dado um veículo, achar produtos compatíveis) — ver
 * docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md.
 */
@Injectable()
export class ProductVehicleSearchService {
  private readonly logger = new Logger(ProductVehicleSearchService.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(ProductCompatibilityModel.name) private readonly compatibilityModel: Model<ProductCompatibilityModel>,
    @InjectModel(CategoryModel.name) private readonly categoryModel: Model<CategoryDocument>,
    private readonly vehicleCompatibilityService: VehicleCompatibilityService,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    private readonly searchCache: SearchResultCacheService,
  ) {}

  /**
   * Checagem de compatibilidade pontual para a PDP (aviso "não compatível com seu veículo") —
   * ver spec de Minha Garagem. Produto universal é sempre compatível.
   */
  async isCompatible(productId: string, vehicleId: string): Promise<boolean> {
    const product = await this.productModel.findById(productId).select('isUniversalFit').lean().exec();
    if (product?.isUniversalFit) return true;

    const link = await this.compatibilityModel.findOne({ productId, vehicleId }).select('_id').lean().exec();
    return !!link;
  }

  /** Seção 4 do spec: busca estruturada — vehicleId específico OU make+model (família inteira). */
  async findByVehicle(options: ByVehicleOptions): Promise<PaginatedResponseDto<ProductModel>> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;

    const vehicleIds = await this.resolveVehicleIds(options);
    const productIds = await this.resolveProductIdsForVehicles(vehicleIds);

    return this.paginateProductsByIdsOrUniversal(productIds, page, limit);
  }

  /**
   * Seção 5 do spec: busca combinada em texto livre ("palheta toro 2025"), sem parsing
   * determinístico — roda contra o searchText combinado de product_compatibilities via Atlas
   * Search, dedupe por produto, união com produtos universais.
   */
  async searchByText(q: string, options: ByTextOptions = {}): Promise<CompatibilitySearchResponseDto> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;

    if (!q?.trim()) {
      return { ...this.emptyResponse(page, limit), facets: this.emptyFacets() };
    }

    const cacheKey = this.searchCache.buildKey(q, { ...options, page, limit });
    const cached = this.searchCache.get<CompatibilitySearchResponseDto>(cacheKey);
    if (cached) return cached;

    const result = await this.computeSearchByText(q, page, limit, options);
    this.searchCache.set(cacheKey, result);
    return result;
  }

  private async computeSearchByText(
    q: string,
    page: number,
    limit: number,
    options: ByTextOptions,
  ): Promise<CompatibilitySearchResponseDto> {
    const [linkedResults, universalProductIds, textMatchResults, vehicleProductIds] = await Promise.all([
      this.atlasSearchProductIds(q.trim()),
      this.matchUniversalProductsByName(q.trim()),
      this.productTextSearchIds(q.trim()),
      options.vehicleId ? this.resolveProductIdsForVehicles([options.vehicleId]) : Promise.resolve(null),
    ]);

    // Com garagem ativa (vehicleId presente), o filtro de veículo é rígido: só produtos
    // vinculados a esse vehicleId (ou universais) entram no resultado, mesmo que o texto
    // livre tenha achado outros produtos por relevância — ver seção "Integração com
    // busca/listagem" do design de Minha Garagem. Nesse caso não faz sentido misturar score
    // de texto — compatibilidade é a única fonte confiável, então usa só os IDs (sem canal
    // de texto direto, que não tem garantia de compatibilidade nenhuma).
    let candidateIds: Types.ObjectId[];
    let scoreById: Map<string, number> | null = null;

    if (vehicleProductIds) {
      const restrictedLinkedIds = linkedResults.map((r) => r.id).filter((id) => vehicleProductIds.includes(id));
      candidateIds = [...new Set([...restrictedLinkedIds, ...universalProductIds])]
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    } else {
      // Sem veículo ativo, compatibilidade não pesa mais que relevância de texto — os três
      // canais competem pelo mesmo ranking normalizado por score (ver mergeChannelsByScore e
      // design doc 2026-07-14 v2).
      const universalOnlyIds = universalProductIds.filter(
        (id) => !linkedResults.some((r) => r.id === id) && !textMatchResults.some((r) => r.id === id),
      );
      scoreById = this.mergeChannelsByScore([linkedResults, textMatchResults], universalOnlyIds);
      candidateIds = [...scoreById.keys()]
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    }

    if (candidateIds.length === 0) {
      return { ...this.emptyResponse(page, limit), facets: this.emptyFacets() };
    }

    // Doc completo (não só os campos de facet) buscado uma única vez aqui — reaproveitado
    // depois pra montar a página, evitando uma segunda ida ao Mongo pelos mesmos produtos.
    // Preço vive no PricingModule (product_pricing), não em ProductModel, por isso o join
    // em lote separado; as duas buscas dependem só de candidateIds, não uma da outra —
    // paralelas.
    // Saldo é usado tanto como desempate de score (canal sem veículo ativo) quanto pra
    // preencher stockQuantity na resposta — estoque não vive mais em ProductModel desde o
    // refactor do StockModule (ver stock-module-refactor-progress); produtos cadastrados
    // depois da migração nunca tiveram esse campo escrito no documento, então o storefront
    // precisa ler ao vivo do StockQueryPort em vez de confiar em campo órfão. Busca em lote
    // junto com preço, mesmo padrão, evitando mais uma ida sequencial ao Mongo.
    const [activeDocs, priceById, availableById] = await Promise.all([
      this.productModel
        .find({ active: true, _id: { $in: candidateIds } } as any)
        .lean()
        .exec(),
      this.pricing.getBasePrices(candidateIds.map((id) => String(id))),
      this.stockQuery.getAvailableBulk(candidateIds.map((id) => String(id))),
    ]);

    let eligible = activeDocs as any[];
    if (options.priceMin !== undefined || options.priceMax !== undefined) {
      eligible = eligible.filter((d) => {
        const price = priceById.get(String(d._id)) ?? 0;
        if (options.priceMin !== undefined && price < options.priceMin) return false;
        if (options.priceMax !== undefined && price > options.priceMax) return false;
        return true;
      });
    }

    // computeFacets (busca de categories p/ nome) e a resolução de categoryNames são duas
    // idas independentes ao mesmo categoryModel — só dependem de `eligible`, não uma da
    // outra — rodam em paralelo em vez de sequencial.
    const [facets, wantedCategoryIds] = await Promise.all([
      this.computeFacets(eligible, priceById),
      options.categoryNames?.length ? this.resolveCategoryIds(options.categoryNames) : Promise.resolve(null),
    ]);

    let filtered = eligible;
    if (options.brandNames?.length) {
      const wanted = new Set(options.brandNames.map((n) => n.toLowerCase()));
      filtered = filtered.filter((d) => d.brand?.name && wanted.has(String(d.brand.name).toLowerCase()));
    }
    if (wantedCategoryIds) {
      filtered = filtered.filter((d) => {
        const id = this.extractCategoryId(d.category);
        return id !== undefined && wantedCategoryIds.has(id);
      });
    }

    // Por padrão, relevância: com vehicleId (scoreById nulo) preserva a ordem já calculada em
    // candidateIds (compatibilidade prioritária); sem vehicleId, ordena pelo score normalizado
    // mesclado entre canais, com saldo>0 como desempate (ver mergeChannelsByScore e design doc
    // 2026-07-14 v2). price_asc/price_desc sempre reordena pelo preço já resolvido em
    // priceById. Em todos os casos os docs completos já estão em mãos (activeDocs/filtered),
    // então ordena-se em memória em vez de uma segunda ida ao Mongo pelos mesmos produtos.
    const rank = new Map(candidateIds.map((id, i) => [String(id), i]));
    const sorted = [...filtered].sort((a, b) => {
      if (options.sort === 'price_asc' || options.sort === 'price_desc') {
        const priceA = priceById.get(String(a._id)) ?? 0;
        const priceB = priceById.get(String(b._id)) ?? 0;
        return options.sort === 'price_asc' ? priceA - priceB : priceB - priceA;
      }
      if (scoreById) {
        const scoreA = scoreById.get(String(a._id)) ?? 0;
        const scoreB = scoreById.get(String(b._id)) ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        const availableA = availableById.get(String(a._id)) ?? 0;
        const availableB = availableById.get(String(b._id)) ?? 0;
        return (availableA > 0 ? 0 : 1) - (availableB > 0 ? 0 : 1);
      }
      return (rank.get(String(a._id)) ?? 0) - (rank.get(String(b._id)) ?? 0);
    });

    const total = sorted.length;
    const skip = (page - 1) * limit;
    const data = sorted.slice(skip, skip + limit).map((d: any) => ({
      ...d,
      price: priceById.get(String(d._id)) ?? 0,
      stockQuantity: availableById.get(String(d._id)) ?? 0,
    }));

    return { ...this.toPaginatedResponse(data, page, limit, total), facets };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async resolveCategoryIds(categoryNames: string[]): Promise<Set<string>> {
    const categories = await this.categoryModel
      .find({ name: { $in: categoryNames.map((n) => new RegExp(`^${this.escapeRegex(n)}$`, 'i')) } })
      .select('_id')
      .lean()
      .exec();
    return new Set(categories.map((c: any) => String(c._id)));
  }

  /**
   * Dados legados em produção guardam `category` como um snapshot embutido
   * `{id, name, parentId, externalId, _id}` em vez do ObjectId real do schema atual — `String()`
   * direto nesse objeto vira "[object Object]" e quebra o cast do Mongo. Sempre extrai o hex do
   * `_id` (real ou embutido) antes de tratar como id de categoria.
   */
  private extractCategoryId(category: any): string | undefined {
    if (!category) return undefined;
    if (typeof category === 'string') return category;
    if (category._id) return String(category._id);
    if (category instanceof Types.ObjectId) return category.toString();
    return undefined;
  }

  /**
   * `eligible` chega pré-filtro de marca/categoria (só pós-filtro de preço, se houver) — não
   * implementamos exclusão de facet por dimensão própria (contagem "se eu trocasse só este
   * filtro") porque a UI atual não expõe essa interação; contagens de marca/categoria refletem o
   * conjunto elegível completo, não o já filtrado por elas mesmas.
   */
  private async computeFacets(eligible: any[], priceById: Map<string, number>): Promise<SearchFacetsDto> {
    const brandCounts = new Map<string, number>();
    for (const d of eligible) {
      const name = d.brand?.name;
      if (!name) continue;
      brandCounts.set(name, (brandCounts.get(name) ?? 0) + 1);
    }
    const brands = [...brandCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const categoryCounts = new Map<string, number>();
    for (const d of eligible) {
      const id = this.extractCategoryId(d.category);
      if (!id) continue;
      categoryCounts.set(id, (categoryCounts.get(id) ?? 0) + 1);
    }
    const validCategoryIds = [...categoryCounts.keys()].filter((id) => Types.ObjectId.isValid(id));
    const categoryDocs = validCategoryIds.length
      ? await this.categoryModel.find({ _id: { $in: validCategoryIds } }).select('name').lean().exec()
      : [];
    const categoryNameById = new Map(categoryDocs.map((c: any) => [String(c._id), c.name]));
    const categories = [...categoryCounts.entries()]
      .map(([id, count]) => ({ name: categoryNameById.get(id), count }))
      .filter((c): c is { name: string; count: number } => Boolean(c.name))
      .sort((a, b) => b.count - a.count);

    const prices = eligible.map((d) => priceById.get(String(d._id)) ?? 0);
    const price = prices.length
      ? { min: Math.min(...prices), max: Math.max(...prices), avg: prices.reduce((a, b) => a + b, 0) / prices.length }
      : { min: 0, max: 0, avg: 0 };

    return { brands, categories, price };
  }

  private emptyFacets(): SearchFacetsDto {
    return { brands: [], categories: [], price: { min: 0, max: 0, avg: 0 } };
  }

  private async resolveVehicleIds(options: ByVehicleOptions): Promise<string[]> {
    if (options.vehicleId) return [options.vehicleId];

    if (options.make || options.model) {
      const { data } = await this.vehicleCompatibilityService.search({
        make: options.make,
        model: options.model,
        active: true,
        limit: 200,
      } as any);
      return data.map((v: any) => String(v._id));
    }

    return [];
  }

  private async resolveProductIdsForVehicles(vehicleIds: string[]): Promise<string[]> {
    if (vehicleIds.length === 0) return [];

    const rows = await this.compatibilityModel
      .find({ vehicleId: { $in: vehicleIds } })
      .select('productId')
      .lean()
      .exec();

    return [...new Set(rows.map((r: any) => r.productId).filter(Boolean))];
  }

  /**
   * Fuzzy (maxEdits:1) em token numérico curto (ex. "2016") é promíscuo — poucos dígitos
   * geram muita colisão com anos vizinhos, poluindo o ranking com veículos errados. Fuzzy só
   * nos tokens alfabéticos (tolera "estrada"→"strada"); ano/número casa exato.
   */
  private buildSearchClauses(q: string, path: string | string[]): any[] {
    return q
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        /^\d+$/.test(token)
          ? { text: { query: token, path } }
          : { text: { query: token, path, fuzzy: { maxEdits: 1 } } },
      );
  }

  /**
   * Score bruto do Atlas Search não é comparável entre índices diferentes (escalas distintas
   * por corpus/campos). Cada canal devolve {id, score} cru; a normalização por score máximo do
   * próprio canal acontece em mergeChannelsByScore, na hora de combinar os canais.
   */
  private async atlasSearchProductIds(q: string): Promise<Array<{ id: string; score: number }>> {
    try {
      const results = await this.compatibilityModel.aggregate([
        {
          $search: {
            index: 'product_compatibility_search',
            compound: { should: this.buildSearchClauses(q, 'searchText'), minimumShouldMatch: 1 },
          },
        },
        { $limit: 500 },
        { $group: { _id: '$productId', score: { $max: { $meta: 'searchScore' } } } },
        { $sort: { score: -1 } },
      ]).exec();

      return results
        .filter((r: any) => r._id)
        .map((r: any) => ({ id: r._id, score: r.score }));
    } catch (err: any) {
      this.logger.warn(`Atlas Search indisponível para busca combinada, fallback pra regex: ${err?.message}`);
      const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
      const rows = await this.compatibilityModel
        .find({ searchText: regex })
        .select('productId')
        .lean()
        .exec();
      const ids = [...new Set(rows.map((r: any) => r.productId).filter(Boolean))];
      return ids.map((id) => ({ id, score: 1 }));
    }
  }

  /**
   * `displayName` é o nome comercial "limpo" do produto (ver spec displayName+category-hint);
   * `name` costuma ser o código/SKU técnico bruto (ex: "CAPA2936") e não carrega significado
   * textual nenhum. Sem boost, um match exato em `name` de OUTRO produto supera um match
   * parcial em `displayName` do produto certo — boost em displayName corrige essa inversão.
   */
  private buildProductTextClauses(q: string): any[] {
    return q
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((token) => {
        const isNumeric = /^\d+$/.test(token);
        const fields: Array<[string, number]> = [
          ['displayName', 3],
          ['name', 1],
          ['partNumber', 1],
        ];
        return fields.map(([field, boost]) =>
          isNumeric
            ? { text: { query: token, path: field, score: { boost: { value: boost } } } }
            : { text: { query: token, path: field, fuzzy: { maxEdits: 1 }, score: { boost: { value: boost } } } },
        );
      });
  }

  /**
   * Terceiro canal de retrieval: busca direto no texto do próprio produto (name/displayName/
   * partNumber), não só na compatibilidade vinculada ou em produtos universais — ver
   * docs/superpowers/specs/2026-07-14-product-text-search-channel-design.md. Sem isso, um
   * produto recém-cadastrado sem compatibilidade ainda e não-universal é invisível pra busca
   * de texto livre, não importa o termo.
   */
  private async productTextSearchIds(q: string): Promise<Array<{ id: string; score: number }>> {
    try {
      const results = await this.productModel.aggregate([
        {
          $search: {
            index: 'product_text_search',
            compound: { should: this.buildProductTextClauses(q), minimumShouldMatch: 1 },
          },
        },
        { $limit: 500 },
        { $project: { _id: 1, score: { $meta: 'searchScore' } } },
      ]).exec();

      return results
        .filter((r: any) => r._id)
        .map((r: any) => ({ id: String(r._id), score: r.score }));
    } catch (err: any) {
      this.logger.warn(`Atlas Search indisponível para busca por texto do produto, fallback pra regex: ${err?.message}`);
      const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
      const rows = await this.productModel
        .find({ $or: [{ name: regex }, { displayName: regex }, { partNumber: regex }] })
        .select('_id')
        .lean()
        .exec();
      return rows.map((r: any) => ({ id: String(r._id), score: 1 }));
    }
  }

  /**
   * Sem veículo ativo, compatibilidade não é mais relevante que match de texto — os dois canais
   * (mais o de produto universal, sem score real) competem pelo mesmo ranking. Score bruto
   * normalizado por score-máximo-do-canal não é robusto aqui: os dois índices têm distribuição
   * de score completamente diferente (compatibilidade indexa texto longo/repetitivo — nomes de
   * veículo, ano — e um match fraco pode ter score alto dentro do próprio corpus, dominando um
   * match de texto de produto genuinamente mais forte). Rank percentil por POSIÇÃO dentro do
   * canal (1º lugar = 1.0, último = próximo de 0, interpolado) é robusto a essa diferença de
   * escala — compara "quão bem colocado" em vez de "quão forte o score bruto". Ao colidir o
   * mesmo produto em mais de um canal, fica o maior rank percentil. Produto universal sem score
   * real (regex) entra com rank 0 quando nenhum outro canal o encontrou.
   */
  private mergeChannelsByScore(
    channels: Array<Array<{ id: string; score: number }>>,
    universalOnlyIds: string[],
  ): Map<string, number> {
    const merged = new Map<string, number>();

    for (const channel of channels) {
      if (channel.length === 0) continue;
      const sorted = [...channel].sort((a, b) => b.score - a.score);
      const n = sorted.length;
      sorted.forEach(({ id }, i) => {
        const percentile = n === 1 ? 1 : 1 - i / (n - 1);
        const existing = merged.get(id);
        if (existing === undefined || percentile > existing) {
          merged.set(id, percentile);
        }
      });
    }

    for (const id of universalOnlyIds) {
      if (!merged.has(id)) merged.set(id, 0);
    }

    return merged;
  }

  private async matchUniversalProductsByName(q: string): Promise<string[]> {
    const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
    const rows = await this.productModel
      .find({ isUniversalFit: true, name: regex })
      .select('_id')
      .lean()
      .exec();
    return rows.map((r: any) => String(r._id));
  }

  private async paginateProductsByIdsOrUniversal(
    productIds: string[],
    page: number,
    limit: number,
  ): Promise<PaginatedResponseDto<ProductModel>> {
    const validIds = productIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const query: any = {
      active: true,
      $or: [{ _id: { $in: validIds } }, { isUniversalFit: true }],
    };

    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.productModel.find(query).skip(skip).limit(limit).lean().exec(),
      this.productModel.countDocuments(query),
    ]);

    // Preço (PricingModule) e estoque (StockModule) não são campos do ProductModel — join em
    // lote, mesmo padrão de computeSearchByText/attachPricesAndStock.
    const ids = rows.map((r: any) => String(r._id));
    const [priceById, availableById] = await Promise.all([
      this.pricing.getBasePrices(ids),
      this.stockQuery.getAvailableBulk(ids),
    ]);
    const data = rows.map((r: any) => ({
      ...r,
      price: priceById.get(String(r._id)) ?? 0,
      stockQuantity: availableById.get(String(r._id)) ?? 0,
    }));

    return this.toPaginatedResponse(data, page, limit, total);
  }

  private toPaginatedResponse(
    data: any[],
    page: number,
    limit: number,
    total: number,
  ): PaginatedResponseDto<ProductModel> {
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  private emptyResponse(page: number, limit: number): PaginatedResponseDto<ProductModel> {
    return { data: [], pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }
}
