import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { ProductCompatibilityModel } from '../schemas/product-compatibility.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { CrossReferenceCodeModel, CrossReferenceCodeDocument } from '../schemas/cross-reference-code.schema';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';
import { PaginatedResponseDto, CompatibilitySearchResponseDto, SearchFacetsDto } from '../dto/product-filter.dto';
import { SearchResultCacheService } from './search-result-cache.service';
import { KnownBrandKeysCacheService } from './known-brand-keys-cache.service';
import { ProductSearchRankingService, RankingCandidate } from './product-search-ranking.service';
import { normalizeCode, normalizeBrand } from '../utils/code-key.util';

/** Nome curto (titleText + subtitle) com fallback pro `name` completo. Ver ProductShortTitleModel. */
function shortName(doc: { titleText?: string; subtitle?: string; name?: string }): string {
  const combined = [doc.titleText, doc.subtitle].filter(Boolean).join(' ');
  return combined || doc.name || '';
}

/**
 * Texto usado só para RANKING (RankingCandidate.ownText), não para exibição —
 * titleText + subtitle + titleSynonyms, SEM fallback pro `name`. Decisão
 * deliberada: `name` (nome completo/técnico bruto) não conta como sinal de
 * busca por texto — só title/subtitle (curados) valem. Produto sem title
 * cadastrado fica sem sinal de texto (ainda é achável por partNumber/código,
 * ver buildProductTextClauses), pressionando a curadoria em vez de mascarar
 * a ausência de title com o nome técnico bruto. Ver
 * docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
 */
function rankingText(doc: { titleText?: string; subtitle?: string; titleSynonyms?: string[] }): string {
  return [doc.titleText, doc.subtitle, ...(doc.titleSynonyms ?? [])].filter(Boolean).join(' ');
}

/** catalogAttributes[].value — ver RankingCandidate.attributeTexts (design doc 2026-07-25-search-ranking-noise-floor). */
function attributeTexts(doc: { catalogAttributes?: Array<{ value?: string }> }): string[] {
  return (doc.catalogAttributes ?? []).map((a) => a.value).filter((v): v is string => !!v);
}

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
    @InjectModel(CrossReferenceCodeModel.name) private readonly crossReferenceCodeModel: Model<CrossReferenceCodeDocument>,
    private readonly vehicleCompatibilityService: VehicleCompatibilityService,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    private readonly searchCache: SearchResultCacheService,
    private readonly knownBrandKeys: KnownBrandKeysCacheService,
    private readonly ranking: ProductSearchRankingService,
  ) {}

  /**
   * Checagem de compatibilidade pontual para a PDP (aviso "não compatível com seu veículo") —
   * ver spec de Minha Garagem. Produto universal é sempre compatível.
   */
  async isCompatible(productId: string, vehicleId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(productId)) return false;

    const product = await this.productModel.findById(productId).select('isUniversalFit').lean().exec();
    if (product?.isUniversalFit) return true;

    const link = await this.compatibilityModel
      .findOne({ product: new Types.ObjectId(productId), vehicleId } as any)
      .select('_id')
      .lean()
      .exec();
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
    // Admin cola o _id direto na busca (não é um caso do storefront) — nenhum dos três
    // canais de retrieval abaixo (Atlas Search / autocomplete / regex) trata a query como
    // id, então um ObjectId válido nunca teria candidatos e a busca voltava vazia.
    const trimmedQuery = q.trim();
    if (Types.ObjectId.isValid(trimmedQuery)) {
      const doc = await this.productModel.findOne({ _id: new Types.ObjectId(trimmedQuery), active: true } as any).lean().exec();
      if (!doc) {
        return { ...this.emptyResponse(page, limit), facets: this.emptyFacets() };
      }
      const [priceById, availableById] = await Promise.all([
        this.pricing.getBasePrices([String((doc as any)._id)]),
        this.stockQuery.getAvailableBulk([String((doc as any)._id)]),
      ]);
      const facets = await this.computeFacets([doc], priceById);
      const data = [{
        ...(doc as any),
        price: priceById.get(String((doc as any)._id)) ?? 0,
        stockQuantity: availableById.get(String((doc as any)._id)) ?? 0,
      }];
      return { ...this.toPaginatedResponse(data, page, limit, 1), facets };
    }

    const words = q.trim().split(/\s+/).filter(Boolean);
    // Resolvido uma única vez aqui (índice único, sub-ms) e reaproveitado tanto pra montar a
    // boost clause do retrieval (buildProductTextClauses, via productTextSearchIds) quanto
    // pro sinal resolvedViaCompoundKey do ranking — evita resolver o mesmo par
    // {brandKey, codeKey} duas vezes por busca.
    const compoundCodeKeys = await this.resolveCompoundBrandCodeMatches(words);
    const compoundCodeKeySet = new Set(compoundCodeKeys);

    const [linkedResults, universalProductIds, textMatchIds, barcodeMatchIds, vehicleProductIds] = await Promise.all([
      this.atlasSearchProductIds(q.trim()),
      this.matchUniversalProductsByName(q.trim()),
      this.productTextSearchIds(q.trim(), compoundCodeKeys),
      this.matchByBarcode(q.trim()),
      options.vehicleId ? this.resolveProductIdsForVehicles([options.vehicleId]) : Promise.resolve(null),
    ]);

    // Com garagem ativa (vehicleId presente), o filtro de veículo é rígido: só produtos
    // vinculados a esse vehicleId (ou universais) entram no resultado, mesmo que o texto
    // livre tenha achado outros produtos por relevância — ver seção "Integração com
    // busca/listagem" do design de Minha Garagem. Nesse caso não faz sentido rankear por
    // texto — compatibilidade é a única fonte confiável, então usa só os IDs (sem canal
    // de texto direto, que não tem garantia de compatibilidade nenhuma).
    let candidateIds: Types.ObjectId[];
    let scoreById: Map<string, number> | null = null;

    if (vehicleProductIds) {
      const restrictedLinkedIds = linkedResults.map((r) => r.id).filter((id) => vehicleProductIds.includes(id));
      candidateIds = [...new Set([...restrictedLinkedIds, ...universalProductIds, ...barcodeMatchIds])]
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    } else {
      // Sem veículo ativo, os canais competem por relevância — mas via
      // ProductSearchRankingService (design doc 2026-07-24-product-search-ranking-pipeline-design.md),
      // não score de Lucene. Precisa dos docs completos (ownText/applicationTexts por produto)
      // ANTES de rankear, então a ordem inverte em relação ao fluxo anterior: junta os IDs
      // brutos primeiro, busca os docs, monta os candidatos com texto real, só então rankeia.
      const rawIds = [
        ...new Set([...linkedResults.map((r) => r.id), ...textMatchIds, ...universalProductIds, ...barcodeMatchIds]),
      ].filter((id) => Types.ObjectId.isValid(id));

      if (rawIds.length === 0) {
        return { ...this.emptyResponse(page, limit), facets: this.emptyFacets() };
      }

      const rawObjectIds = rawIds.map((id) => new Types.ObjectId(id));
      const rawDocs = await this.productModel
        .find({ active: true, _id: { $in: rawObjectIds } } as any)
        .select('name titleText titleSynonyms subtitle partNumberKey oemCodesKeys isUniversalFit catalogAttributes.value')
        .lean()
        .exec();

      const applicationTextsById = new Map(linkedResults.map((r) => [r.id, r.applicationTexts]));
      const universalIdSet = new Set(universalProductIds);
      const rankingCandidates: RankingCandidate[] = (rawDocs as any[]).map((d) => {
        const id = String(d._id);
        const ownCodeKeys: string[] = [d.partNumberKey, ...(d.oemCodesKeys ?? [])].filter(Boolean);
        return {
          id,
          ownText: rankingText(d),
          ownCode: ownCodeKeys.join(' '),
          applicationTexts: applicationTextsById.get(id),
          attributeTexts: attributeTexts(d),
          isUniversal: d.isUniversalFit || universalIdSet.has(id),
          resolvedViaCompoundKey: compoundCodeKeySet.size > 0 && ownCodeKeys.some((k) => compoundCodeKeySet.has(k)),
        };
      });

      const ranked = this.ranking.rankCandidates(q.trim(), rankingCandidates);
      scoreById = new Map(ranked.map((r) => [r.id, r.score]));
      candidateIds = ranked
        .map((r) => r.id)
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
    // candidateIds (compatibilidade prioritária); sem vehicleId, ordena pelo score do
    // ProductSearchRankingService, com saldo>0 como desempate. price_asc/price_desc sempre
    // reordena pelo preço já resolvido em priceById. Em todos os casos os docs completos já
    // estão em mãos (activeDocs/filtered), então ordena-se em memória em vez de uma segunda
    // ida ao Mongo pelos mesmos produtos.
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
      .select('product')
      .lean()
      .exec();

    return [...new Set(rows.map((r: any) => r.product && String(r.product)).filter(Boolean))];
  }

  /**
   * Fuzzy (maxEdits:1) em token numérico curto (ex. "2016") é promíscuo — poucos dígitos
   * geram muita colisão com anos vizinhos, poluindo o ranking com veículos errados. Fuzzy só
   * nos tokens alfabéticos (tolera "estrada"→"strada"); ano/número casa exato.
   *
   * `prefixLength: 2` no fuzzy alfabético: sem isso, um token curto/incompleto (o usuário
   * ainda digitando — ex. "rene" de "Renegade") tem um espaço de colisão editada-por-1
   * enorme sobre um corpus de milhares de searchText, e pode bater em algo completamente
   * não relacionado, contaminando o ranking com falso positivo forte (bug real observado:
   * "rene" batendo em compatibilidade de um Citroën Jumpy/Peugeot Expert, sem nenhuma
   * relação com Jeep Renegade). Exigir que os 2 primeiros caracteres batam exato ainda
   * cobre erro de digitação real (troca de letra do meio/fim), só não cobre erro na
   * primeira/segunda letra — trade-off aceito, mesmo já usado no fuzzy de partNumberKey/
   * oemCodesKeys (buildProductTextClauses).
   */
  private buildSearchClauses(q: string, path: string | string[]): any[] {
    return q
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        /^\d+$/.test(token)
          ? { text: { query: token, path } }
          : { text: { query: token, path, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
      );
  }

  /**
   * Retrieval (design doc 2026-07-24-product-search-ranking-pipeline-design.md) — só acha
   * candidatos plausíveis via Atlas Search (fuzzy/tolerante) e devolve o texto REAL que casou
   * (`applicationTexts`), não o score bruto do Lucene. Ranking (força do match) é recalculado
   * em `ProductSearchRankingService` comparando texto contra texto — score de índices Atlas
   * Search diferentes não é comparável entre si (corpus/campos/distribuição diferentes por
   * índice), causou bugs recorrentes quando ranking dependia dele.
   */
  private async atlasSearchProductIds(q: string): Promise<Array<{ id: string; applicationTexts: string[] }>> {
    try {
      const results = await this.compatibilityModel.aggregate([
        {
          $search: {
            index: 'product_compatibility_search',
            compound: { should: this.buildSearchClauses(q, 'searchText'), minimumShouldMatch: 1 },
          },
        },
        { $limit: 500 },
        { $group: { _id: '$product', vehicleNames: { $addToSet: '$vehicleName' } } },
      ]).exec();

      return results
        .filter((r: any) => r._id)
        .map((r: any) => ({ id: String(r._id), applicationTexts: (r.vehicleNames ?? []).filter(Boolean) }));
    } catch (err: any) {
      this.logger.warn(`Atlas Search indisponível para busca combinada, fallback pra regex: ${err?.message}`);
      const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
      const rows = await this.compatibilityModel
        .find({ searchText: regex })
        .select('product vehicleName')
        .lean()
        .exec();
      const byProduct = new Map<string, Set<string>>();
      for (const r of rows as any[]) {
        const id = r.product && String(r.product);
        if (!id) continue;
        if (!byProduct.has(id)) byProduct.set(id, new Set());
        if (r.vehicleName) byProduct.get(id)!.add(r.vehicleName);
      }
      return [...byProduct.entries()].map(([id, names]) => ({ id, applicationTexts: [...names] }));
    }
  }

  /**
   * `titleText` é o nome curto reutilizável do produto (ProductShortTitle — ver spec
   * product-title-subtitle); `subtitle` é sua especialização. `name` (nome completo/
   * técnico bruto, ex: "CAPA2936") NÃO conta como sinal de busca por texto — decisão
   * deliberada: 99,9% do catálogo ainda não tem title curado (pré-migração), e usar
   * `name` como fallback de busca mascararia essa ausência em vez de pressionar a
   * curadoria. Produto sem title continua achável por código (partNumber/
   * partNumberKey/oemCodesKeys, abaixo) — só não aparece mais buscando por palavras
   * do nome técnico bruto. `titleText` já contém os sinônimos denormalizados do
   * ProductShortTitle via `titleSynonyms` (índice separado, ver
   * atlas-search-index-product-text.json) — não precisa de synonyms mapping do Atlas
   * Search aqui. Ver docs/superpowers/specs/2026-07-25-product-title-subtitle-design.md.
   *
   * partNumberKey (analisado como lucene.keyword no índice — ver
   * atlas-search-index-product-text.json) recebe uma cláusula própria, exata
   * e normalizada com normalizeCode(), em vez de depender do tokenizer padrão
   * do Lucene em `partNumber`. Um código como "21.1189-F" quebra em tokens
   * "21"/"1189"/"F" pelo analisador padrão (hífen/ponto são delimitadores) —
   * uma busca por "211189f" nunca bate contra isso, mesmo com fuzzy, porque
   * a diferença é estrutural (falta de token), não ortográfica. Normalizar
   * dos dois lados (índice + query) e comparar como keyword resolve isso do
   * jeito determinístico, sem depender do analisador genérico de texto —
   * mesmo princípio já usado em partNumberKey/oemCodesKeys no Mongo clássico.
   */
  private async buildProductTextClauses(q: string, compoundCodeKeys: string[]): Promise<any[]> {
    const words = q.split(/\s+/).filter(Boolean);

    const tokenClauses = words.flatMap((token) => {
      const isNumeric = /^\d+$/.test(token);
      const fields: Array<[string, number]> = [
        ['titleText', 3],
        ['titleSynonyms', 3],
        ['subtitle', 2],
        ['partNumber', 1],
      ];
      return fields.map(([field, boost]) =>
        isNumeric
          ? { text: { query: token, path: field, score: { boost: { value: boost } } } }
          : { text: { query: token, path: field, fuzzy: { maxEdits: 1 }, score: { boost: { value: boost } } } },
      );
    });

    // Vocabulário PT-BR (design doc section 3): cliente busca informal
    // ("pastilha") enquanto o catálogo indexa técnico ("pastilha de freio"),
    // ou vice-versa. `search_synonyms` já existe e já é curado — usado hoje
    // só pelo índice product_compatibility_search; estende-se aqui pro texto
    // de produto sem criar dado novo. Atlas Search não permite `synonyms` e
    // `fuzzy` na MESMA cláusula `text` — por isso isto é uma cláusula
    // adicional (sem fuzzy) rodando ao lado das de tokenClauses acima, não
    // uma substituição: cobre o caso de vocabulário divergente, tokenClauses
    // continua cobrindo erro de digitação. Só em titleText (texto livre curado)
    // — partNumber/partNumberKey/oemCodesKeys são código, sinônimo do Atlas
    // Search mapping não se aplica a eles (titleText já carrega os sinônimos
    // do ProductShortTitle diretamente); `name` está fora de escopo de busca.
    const synonymClauses = words
      .filter((token) => !/^\d+$/.test(token))
      .map((token) => (
        { text: { query: token, path: 'titleText', synonyms: 'product_text_synonyms', score: { boost: { value: 3 } } } }
      ));

    // Exact match covers punctuation-only differences ("21.1189-F" vs
    // "211189f") — both normalize to the same key, so this is a
    // deterministic hit, no edit-distance guesswork needed.
    //
    // Fuzzy match covers real character-level typos on TOP of that same
    // normalized field — e.g. "211189FF" (extra letter) or a transposed
    // digit against "211189F". Running fuzzy on a lucene.keyword field (one
    // token, the whole normalized code) instead of on partNumber/name
    // (lucene.standard — tokenized on punctuation/whitespace) is the
    // difference that makes this work: fuzzy there would only ever compare
    // within a fragment split at the "." or "-", never across the number as
    // a whole. maxEdits 2 for codes >6 chars mirrors Elasticsearch's own
    // default "AUTO" fuzziness tiering (0 edits for very short terms, 1 for
    // short-medium, 2 for longer) — a fixed maxEdits:1 would be too strict
    // for longer codes and too loose for short ones.
    const buildKeyFieldClauses = (normalizedTerm: string, path: string, boost: number): any[] =>
      normalizedTerm
        ? [
          { text: { query: normalizedTerm, path, score: { boost: { value: boost } } } },
          {
            text: {
              query: normalizedTerm,
              path,
              fuzzy: { maxEdits: normalizedTerm.length > 6 ? 2 : 1, prefixLength: 2 },
              score: { boost: { value: boost / 2.5 } },
            },
          },
        ]
        : [];

    // Applied per WORD, not on the whole query string — a search like
    // "sl092 solopes" (code + brand, a completely normal way to search) must
    // become two independent key-field attempts ("SL092", "SOLOPES"), each
    // able to match on its own. normalizeCode() strips internal whitespace,
    // so running it on q as a whole would glue every word together into one
    // string ("SL092SOLOPES") that can never match any single stored key —
    // that was the actual bug reported: a code + brand query returned nothing
    // even though the code existed, because it was only ever compared as one
    // fused blob. The whole-query form is kept too (deduped via the Set
    // below) so a single code that itself contains a space when typed alone
    // (e.g. "SL 092") still matches as one term.
    //
    // Leading-zero normalization (design doc section 2) was investigated and
    // deliberately NOT implemented: checked real data before writing this —
    // 561+ of a 5000-row sample of cross_reference_codes have the SAME brand
    // carrying both a leading-zero and a stripped form as DIFFERENT,
    // legitimate codes (e.g. brand AXIOS: "044.1130" and "441130" are two
    // distinct real parts, not the same part written two ways). Unlike
    // punctuation (".", "-", " " — confirmed decorative, safe to strip
    // everywhere), a leading zero on these codes is sometimes meaningful
    // digits, not padding — there's no reliable way to tell which case a
    // given query is without risking a false-positive match to the wrong
    // part. The false-positive cost (showing a customer/seller a real but
    // WRONG part) outweighs the recall gain, so this stays a plain-text
    // match only (no key-field variant generation).
    const normalizedTerms = Array.from(
      new Set([...words.map((w) => normalizeCode(w)), normalizeCode(q)].filter(Boolean)),
    );

    // partNumberKey: the product's OWN code — highest priority (boost 5).
    // oemCodesKeys: cross-reference/OEM-equivalent codes (e.g. "0734 310 109"
    // for a ZF part whose own code is "21.1189-F") — the product doesn't
    // carry this code itself, so it's a weaker signal than an own-code match,
    // but without it a cross-reference-only query returns nothing even
    // though cross_reference_codes and the product's own denormalized
    // oemCodesKeys both already have the answer (see cross-reference.service
    // handleGroupUpdate, which keeps oemCodesKeys in sync per group). Lower
    // boost (3) than partNumberKey, still above plain text fields.
    const keyFieldClauses = normalizedTerms.flatMap((term) => [
      ...buildKeyFieldClauses(term, 'partNumberKey', 5),
      ...buildKeyFieldClauses(term, 'oemCodesKeys', 3),
    ]);

    // Compound-key marca+código (design doc section 1): two different
    // manufacturers can reuse the same code for unrelated parts (the code
    // space isn't global, it's per-manufacturer) — confirmed with real data,
    // e.g. codeKey "0000535358" is claimed by BOTH brand "MBB" (-> product
    // "48.9237-F", brand Spaal Juntas) and brand "Original" (-> product
    // "567.401", brand Elring) as two distinct cross_reference_codes rows in
    // two different groups. A bare code match without brand can surface the
    // wrong one.
    //
    // The brand a user types alongside a cross-reference code (e.g. "MBB
    // 0000535358") is the CROSS-REFERENCE's brand, not the sold product's own
    // brand — those are usually different (the product above is sold under
    // "Spaal Juntas", never "MBB"). So this can't be resolved by testing the
    // typed brand against the product's own name/titleText/subtitle/brand field —
    // there's nothing there to match. It has to be resolved the same way
    // processCrossReferences resolves it when WRITING: look up
    // {brandKey, codeKey} in cross_reference_codes directly (unique index,
    // sub-ms), get the groupId, and boost products linked to THAT group.
    //
    // Boost only, never a hard filter — "Cofap" is sometimes used
    // generically for "shock absorber" by customers (not literally the
    // brand), so requiring brand+code as a hard AND would wrongly exclude
    // legitimate results when brand is meant loosely, and a brand+code pair
    // that doesn't resolve to any cross_reference_codes row just yields no
    // extra boost (falls back to the plain keyFieldClauses above).
    //
    // compoundCodeKeys já vem resolvido pelo chamador (computeSearchByText) —
    // evita resolver o mesmo {brandKey, codeKey} duas vezes (uma pra montar a
    // boost clause aqui, outra pro sinal resolvedViaCompoundKey do ranking).
    const compoundBrandCodeClauses = compoundCodeKeys.flatMap((codeKey) => [
      { text: { query: codeKey, path: 'partNumberKey', score: { boost: { value: 10 } } } },
      { text: { query: codeKey, path: 'oemCodesKeys', score: { boost: { value: 10 } } } },
    ]);

    return [...tokenClauses, ...synonymClauses, ...keyFieldClauses, ...compoundBrandCodeClauses];
  }

  /**
   * Compound-key marca+código (design doc 2026-07-24-search-engine-robustness-design.md
   * seção 1): dois fabricantes podem reutilizar o mesmo código pra peças diferentes (o
   * espaço de numeração não é global, é por fabricante) — confirmado com dado real, ex.
   * codeKey "0000535358" é reivindicado tanto por brand "MBB" (-> produto "48.9237-F", marca
   * Spaal Juntas) quanto por brand "Original" (-> produto "567.401", marca Elring), duas
   * linhas distintas em cross_reference_codes. Um match de código sozinho pode achar o
   * produto errado.
   *
   * A marca digitada junto do código de cross-reference (ex. "MBB 0000535358") é a marca DO
   * CROSS-REFERENCE, não a marca do produto vendido — quase nunca coincidem (o produto acima
   * é vendido como "Spaal Juntas", nunca "MBB"). Por isso não dá pra resolver testando a
   * marca digitada contra name/titleText/subtitle/brand do produto — não há nada ali pra bater. Tem
   * que ser resolvido do mesmo jeito que processCrossReferences resolve na ESCRITA: procurar
   * {brandKey, codeKey} direto em cross_reference_codes (índice único, sub-ms), pegar o
   * groupId, e devolver TODOS os codeKey do grupo (o produto certo tem um desses como seu
   * próprio código).
   *
   * Extraído como método próprio (compartilhado por buildProductTextClauses, que monta
   * cláusula Atlas Search pra busca completa, e autocomplete, que usa como retrieval
   * direto) — antes só existia dentro de buildProductTextClauses, então "MBB 0000535358" no
   * autocomplete nunca resolvia o compound-key (autocomplete usa o índice product_autocomplete,
   * não product_text_search, e nunca chamava essa lógica).
   */
  private async resolveCompoundBrandCodeMatches(words: string[]): Promise<string[]> {
    const brandTokens = await Promise.all(
      words.map(async (w) => ({ raw: w, brandKey: normalizeBrand(w), isBrand: await this.knownBrandKeys.has(normalizeBrand(w)) })),
    );
    const knownBrandWords = brandTokens.filter((t) => t.isBrand);
    const codeWords = words.filter((w) => !knownBrandWords.some((b) => b.raw === w) && normalizeCode(w).length >= 3);

    if (knownBrandWords.length === 0 || codeWords.length === 0) return [];

    const lookups = knownBrandWords.flatMap((brandToken) =>
      codeWords.map((codeWord) => ({ brandKey: brandToken.brandKey, codeKey: normalizeCode(codeWord) })),
    );
    const rows = await this.crossReferenceCodeModel
      .find({ $or: lookups })
      .select('groupId')
      .lean()
      .exec();
    const groupIds = [...new Set(rows.map((r: any) => String(r.groupId)))];
    if (groupIds.length === 0) return [];

    // Every code sharing the resolved group(s) — including the group's OWN
    // product code — becomes a high-confidence match target. Reusing
    // oemCodesKeys (already denormalized per group by
    // CrossReferenceService.handleGroupUpdate) instead of a second query for
    // group membership.
    const groupCodeRows = await this.crossReferenceCodeModel
      .find({ groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
      .select('codeKey')
      .lean()
      .exec();
    return [...new Set(groupCodeRows.map((r: any) => r.codeKey))];
  }

  /**
   * Terceiro canal de retrieval: busca direto no texto do próprio produto (name/titleText/subtitle/
   * partNumber), não só na compatibilidade vinculada ou em produtos universais — ver
   * docs/superpowers/specs/2026-07-14-product-text-search-channel-design.md. Sem isso, um
   * produto recém-cadastrado sem compatibilidade ainda e não-universal é invisível pra busca
   * de texto livre, não importa o termo.
   */
  private async productTextSearchIds(q: string, compoundCodeKeys: string[]): Promise<string[]> {
    try {
      const clauses = await this.buildProductTextClauses(q, compoundCodeKeys);
      const results = await this.productModel.aggregate([
        {
          $search: {
            index: 'product_text_search',
            compound: { should: clauses, minimumShouldMatch: 1 },
          },
        },
        { $limit: 500 },
        { $project: { _id: 1 } },
      ]).exec();

      return results.filter((r: any) => r._id).map((r: any) => String(r._id));
    } catch (err: any) {
      this.logger.warn(`Atlas Search indisponível para busca por texto do produto, fallback pra regex: ${err?.message}`);
      const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
      const rows = await this.productModel
        .find({
          $or: [
            { titleText: regex },
            { titleSynonyms: regex },
            { subtitle: regex },
            { partNumber: regex },
          ],
        })
        .select('_id')
        .lean()
        .exec();
      return rows.map((r: any) => String(r._id));
    }
  }

  /**
   * Type-ahead (design doc 2026-07-24-search-engine-robustness-design.md seção 4,
   * ranking via 2026-07-24-product-search-ranking-pipeline-design.md): sugestões leves
   * conforme o usuário digita — sem facets/preço/paginação, só uma lista curta de labels
   * pra dropdown.
   *
   * Retrieval de duas fontes (só candidatos, sem decidir ordem ainda):
   * - `product_autocomplete` (índice dedicado, edgeGram) — candidatos por texto do PRÓPRIO
   *   produto (nome/titleText/subtitle/código). Bom pra "o usuário está digitando o nome/código da
   *   peça".
   * - `atlasSearchProductIds` (mesmo canal que a busca completa usa, `product_compatibility_search`)
   *   — candidatos por APLICAÇÃO/veículo. Sem isso, uma query tipo "filtro combustivel
   *   renegade" não encontra o produto certo: o nome do produto raramente contém o nome do
   *   veículo por completo (isso vive em product_compatibilities, não em Product).
   *
   * Ranking real (ProductSearchRankingService) roda DEPOIS, sobre texto real dos candidatos
   * já buscados — não sobre score de Lucene dos dois índices (foi essa comparação que causou
   * bugs recorrentes: produto com match textual genérico forte vencendo produto com aplicação
   * exata, ver design doc "Contexto").
   *
   * `q` curto (<2 chars) não busca — edgeGram com minGrams:2 não indexa nada útil abaixo
   * disso, e evitar ida ao Atlas Search por tecla digitada quando ainda não há sinal.
   */
  async autocomplete(
    q: string,
    limit = 8,
    vehicleId?: string,
  ): Promise<Array<{
    id: string;
    slug?: string;
    label: string;
    partNumber: string;
    brand?: string;
    compatibleWithVehicle?: boolean;
    applicationsSummary?: string[];
  }>> {
    const trimmed = q?.trim();
    if (!trimmed || trimmed.length < 2) return [];

    try {
      const words = trimmed.split(/\s+/).filter(Boolean);
      // normalizeCode(trimmed) some espaço/pontuação junto — só faz sentido como termo
      // único quando a query inteira É um código digitado sem espaço (ex. "fap9"). Uma
      // query multi-palavra tipo "fap9 wega" também precisa do código isolado por
      // palavra, senão "fap9 wega" normalizado vira "FAP9WEGA", que nunca é prefixo de
      // nada — mesma classe de bug já corrigida em buildProductTextClauses (seção
      // "Applied per WORD" mais abaixo neste arquivo).
      const normalizedCodeTerms = [...new Set([normalizeCode(trimmed), ...words.map((w) => normalizeCode(w))])].filter(
        (t) => t.length >= 2,
      );

      const [ownTextResults, compatibilityResults, compoundCodeKeys] = await Promise.all([
        this.productModel.aggregate([
          {
            $search: {
              index: 'product_autocomplete',
              compound: {
                should: [
                  { autocomplete: { query: trimmed, path: 'titleText' } },
                  { autocomplete: { query: trimmed, path: 'titleSynonyms' } },
                  { autocomplete: { query: trimmed, path: 'subtitle' } },
                  { autocomplete: { query: trimmed, path: 'partNumber' } },
                  ...normalizedCodeTerms.flatMap((term) => [
                    { autocomplete: { query: term, path: 'partNumberKey' } },
                    { autocomplete: { query: term, path: 'oemCodesKeys' } },
                  ]),
                ],
                minimumShouldMatch: 1,
              },
            },
          },
          { $match: { active: true } },
          { $limit: 50 },
          { $project: { _id: 1 } },
        ]).exec(),
        this.atlasSearchProductIds(trimmed),
        // Terceiro retrieval: compound-key marca+código (ex. "MBB 0000535358") — resolve
        // via cross_reference_codes, não via os índices Atlas Search acima, que não têm
        // como saber que "MBB" é a marca de um CROSS-REFERENCE do produto, não o produto
        // em si (ver resolveCompoundBrandCodeMatches).
        this.resolveCompoundBrandCodeMatches(words),
      ]);

      let compoundCodeProductIds: string[] = [];
      if (compoundCodeKeys.length > 0) {
        const compoundCodeDocs = await this.productModel
          .find({ $or: [{ partNumberKey: { $in: compoundCodeKeys } }, { oemCodesKeys: { $in: compoundCodeKeys } }], active: true } as any)
          .select('_id')
          .lean()
          .exec();
        compoundCodeProductIds = (compoundCodeDocs as any[]).map((d) => String(d._id));
      }

      const rawIds = [
        ...new Set([
          ...(ownTextResults as any[]).map((r) => String(r._id)),
          ...compatibilityResults.map((r) => r.id),
          ...compoundCodeProductIds,
        ]),
      ].filter((id) => Types.ObjectId.isValid(id));

      if (rawIds.length === 0) return [];

      const objectIds = rawIds.map((id) => new Types.ObjectId(id));
      const [products, compatRows] = await Promise.all([
        this.productModel
          .find({ _id: { $in: objectIds }, active: true } as any)
          .select('name titleText titleSynonyms subtitle partNumber partNumberKey oemCodesKeys slug brand.name catalogAttributes.value')
          .lean()
          .exec(),
        // {product:1, vehicleId:1} prefix on ProductCompatibilityModel's own
        // compound index (product-compatibility.schema.ts) covers both the
        // "product IN [...]" scan and, when vehicleId is given, distinguishing
        // the active vehicle's rows from the rest in application code — no
        // second round-trip.
        this.compatibilityModel
          .find({ product: { $in: objectIds } } as any)
          .select('product vehicleId vehicleName')
          .lean()
          .exec(),
      ]);

      const applicationsByProduct = new Map<string, string[]>();
      const compatibleVehicleProductIds = new Set<string>();
      for (const row of compatRows as any[]) {
        const productId = String(row.product);
        if (!applicationsByProduct.has(productId)) applicationsByProduct.set(productId, []);
        if (row.vehicleName) applicationsByProduct.get(productId)!.push(row.vehicleName);
        if (vehicleId && row.vehicleId === vehicleId) compatibleVehicleProductIds.add(productId);
      }

      const productsById = new Map((products as any[]).map((p) => [String(p._id), p]));
      const compoundCodeKeySet = new Set(compoundCodeKeys);

      const rankingCandidates: RankingCandidate[] = (products as any[]).map((p) => {
        const id = String(p._id);
        const ownCodeKeys: string[] = [p.partNumberKey, ...(p.oemCodesKeys ?? [])].filter(Boolean);
        return {
          id,
          ownText: rankingText(p),
          ownCode: ownCodeKeys.join(' '),
          applicationTexts: applicationsByProduct.get(id),
          attributeTexts: attributeTexts(p),
          resolvedViaCompoundKey: compoundCodeKeySet.size > 0 && ownCodeKeys.some((k) => compoundCodeKeySet.has(k)),
        };
      });

      const ranked = this.ranking.rankCandidates(trimmed, rankingCandidates).slice(0, limit);

      return ranked
        .map(({ id }) => productsById.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((r: any) => {
          const id = String(r._id);
          const applications = applicationsByProduct.get(id) ?? [];
          return {
            id,
            slug: r.slug,
            label: shortName(r),
            partNumber: r.partNumber,
            brand: r.brand?.name,
            compatibleWithVehicle: vehicleId ? compatibleVehicleProductIds.has(id) : undefined,
            // Capped at 3 — this is a dropdown suggestion, not the PDP's full
            // compatibility list; avoids a wall of text under each item.
            applicationsSummary: applications.length > 0 ? applications.slice(0, 3) : undefined,
          };
        });
    } catch (err: any) {
      this.logger.warn(`Atlas Search indisponível para autocomplete: ${err?.message}`);
      return [];
    }
  }

  /**
   * Exceção deliberada ao "name fora da busca" (ver buildProductTextClauses):
   * produto universal (óleo, graxa, etc.) não tem código específico de
   * veículo pra ser achado por partNumber/oemCodesKeys, então sem o fallback
   * pro nome bruto ficaria praticamente inachável enquanto não tiver title
   * curado. Minoria do catálogo — risco de ruído aceito aqui.
   */
  private async matchUniversalProductsByName(q: string): Promise<string[]> {
    const regex = new RegExp(q.split(/\s+/).filter(Boolean).join('|'), 'i');
    const rows = await this.productModel
      .find({ isUniversalFit: true, name: regex })
      .select('_id')
      .lean()
      .exec();
    return rows.map((r: any) => String(r._id));
  }

  /**
   * Match exato por código de barras — canal simples fora do índice Atlas Search
   * (que mapeia só titleText/titleSynonyms/subtitle/partNumber; estender o mapeamento
   * do índice em produção é mudança de infra separada). Mesmo padrão de
   * matchUniversalProductsByName: canal de retrieval independente, mesclado com os
   * demais IDs em computeSearchByText. Só match exato (barcode é código, não texto
   * livre — fuzzy geraria falsos positivos entre códigos numéricos próximos).
   */
  private async matchByBarcode(q: string): Promise<string[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];
    const rows = await this.productModel
      .find({ barcode: trimmed })
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
