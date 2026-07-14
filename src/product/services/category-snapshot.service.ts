import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MlAttributeHydrationService } from '../../marketplace/services/ml-attribute-hydration.service';
import { CategoryService } from '../../marketplace/services/category.service';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import type {
  CategorySnapshotDto,
  HydratedCategoryDto,
  MlSnapshotStateDto,
  MlPublishPayloadDto,
  MlResolutionDto,
} from '../dto/category-snapshot.dto';

@Injectable()
export class CategorySnapshotService {
  private readonly logger = new Logger(CategorySnapshotService.name);

  constructor(
    @InjectModel('ProductModel') private readonly productModel: Model<any>,
    @InjectModel('CategoryModel') private readonly categoryModel: Model<any>,
    @InjectModel('ProductDiscoveryModel') private readonly discoveryModel: Model<any>,
    private readonly mlHydration: MlAttributeHydrationService,
    private readonly categoryService: CategoryService,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  async buildForProduct(productId: string): Promise<CategorySnapshotDto> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException(`Invalid product id: ${productId}`);
    }
    const oid = new Types.ObjectId(productId);

    const [product, discoveryDoc, mlMarketplace] = await Promise.all([
      this.productModel.findById(oid).lean().exec(),
      this.discoveryModel
        .findOne({ productId: oid, isActiveIntent: true })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.configCache.getByName('Mercado Livre'),
    ]);
    if (!product) throw new NotFoundException(`Product not found: ${productId}`);

    const internalCategory = await this.hydrateInternalCategory(product.category);
    const resolvedCategoryId = discoveryDoc?.resolvedCategoryId
      ? String(discoveryDoc.resolvedCategoryId)
      : null;
    const resolvedCategory = resolvedCategoryId
      ? await this.hydrateInternalCategory(new Types.ObjectId(resolvedCategoryId))
      : null;
    // category_id do ML (do discovery) — permite o auto-cadastro da categoria via IA
    // quando não há categoria interna nem resolvedCategoryId.
    const mlCategoryId: string | null = discoveryDoc?.final?.mlCategoryId ?? null;

    const { ml, resolution } = internalCategory && mlMarketplace
      ? await this.resolveMl(product, internalCategory, String(mlMarketplace._id))
      : { ml: null, resolution: { status: 'no_category' as const, mlCategoryId: null } };

    return {
      productId: String(productId),
      product,
      internalCategory,
      discovery: { resolvedCategoryId, resolvedCategory, mlCategoryId },
      ml,
      mlResolution: resolution,
    };
  }

  /**
   * Resolve o estado ML da categoria interna E o diagnóstico de resolução num só
   * passo. O diagnóstico é a fonte de verdade para o fluxo centralizado saber o que
   * fazer quando não há atributos (sem mapping / mapping não-folha / pronto).
   */
  private async resolveMl(
    product: any,
    hydratedCategory: HydratedCategoryDto,
    marketplaceId: string,
  ): Promise<{ ml: MlSnapshotStateDto | null; resolution: MlResolutionDto }> {
    const mapping = (hydratedCategory.marketplaceMappings ?? []).find(
      (m: any) => String(m.marketplaceId) === marketplaceId,
    );
    const externalCategoryId = String(
      mapping?.externalId ?? mapping?.id ?? mapping?.categoryResult?.category_id ?? '',
    ).trim();

    // Sem nenhum mapping ML → categoria interna não é publicável até resolver.
    if (!externalCategoryId) {
      return { ml: null, resolution: { status: 'unmapped', mlCategoryId: null } };
    }

    // Mapping é nó NÃO-folha (ML só publica em folha) → precisa descer até a folha.
    // `isLeaf === false` é sinal explícito; `listingAllowed === false` idem.
    const isNonLeaf = mapping?.isLeaf === false || mapping?.listingAllowed === false;
    if (isNonLeaf) {
      return { ml: null, resolution: { status: 'needs_leaf', mlCategoryId: externalCategoryId } };
    }

    const ml = await this.buildMlState(product, externalCategoryId, marketplaceId);
    if (!ml) {
      // Tinha externalId folha mas o schema não carregou (falha ML transitória) →
      // trata como needs_leaf p/ o fluxo tentar resolver/reprocessar, não como pronto.
      return { ml: null, resolution: { status: 'needs_leaf', mlCategoryId: externalCategoryId } };
    }
    return { ml, resolution: { status: 'ready', mlCategoryId: externalCategoryId } };
  }

  /**
   * Payload canônico de publicação ML para o orchestrator. Resolve o schema ML da
   * categoria interna e hidrata TODOS os atributos (incl. obrigatórios: PART_NUMBER,
   * BRAND, GTIN, dimensões) a partir do estado atual do produto — a mesma lógica que
   * alimenta o snapshot do app. Resolvido na leitura, nada materializado (zero stale).
   * Retorna `null` quando não há categoria interna ou schema ML (fail-closed no worker).
   */
  async resolveMlPublish(
    productId: string,
    marketplaceId: string,
  ): Promise<MlPublishPayloadDto | null> {
    if (!Types.ObjectId.isValid(productId)) return null;
    const product = await this.productModel
      .findById(new Types.ObjectId(productId))
      .lean()
      .exec();
    if (!product) return null;

    const internalCategory = await this.hydrateInternalCategory(product.category);
    if (!internalCategory) return null;

    const { ml } = await this.resolveMl(product, internalCategory, marketplaceId);
    if (!ml) return null;

    return {
      externalCategoryId: ml.externalCategoryId,
      attributes: ml.attributesPayload,
      missing: ml.missing,
    };
  }

  private async hydrateInternalCategory(catRef: any): Promise<HydratedCategoryDto | null> {
    if (!catRef) return null;
    const id = typeof catRef === 'string' || catRef instanceof Types.ObjectId
      ? String(catRef)
      : String(catRef._id ?? catRef.id ?? '');
    if (!id || !Types.ObjectId.isValid(id)) return null;

    const raw = await this.categoryModel.findById(id).lean().exec();
    if (!raw) return null;

    return {
      id: String(raw._id),
      name: raw.name ?? raw.title ?? '',
      breadcrumbs: raw.breadcrumbs ?? '',
      marketplaceMappings: raw.marketplaceMappings,
      raw,
    };
  }

  private async buildMlState(
    product: any,
    externalCategoryId: string,
    marketplaceId: string,
  ): Promise<MlSnapshotStateDto | null> {
    if (!externalCategoryId) return null;

    let mlSchema: any[] | null = null;
    try {
      mlSchema = await this.categoryService.getCategoryAttributes(marketplaceId, externalCategoryId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to load ML schema for ${externalCategoryId}: ${message}`);
      return null;
    }
    if (!Array.isArray(mlSchema)) return null;

    const hydratedValues = this.mlHydration.hydrateMlValues(product, marketplaceId);
    this.mlHydration.applyFixedSchemaValues(mlSchema, hydratedValues);
    this.mlHydration.applyMlDimensionClamping(hydratedValues);

    const required = mlSchema.filter((a: any) => a?.tags?.required);
    const optional = mlSchema.filter((a: any) => !a?.tags?.required);
    const missing = this.mlHydration.computeMissingMlRequiredAttrs(mlSchema, hydratedValues);
    const attributesPayload = this.mlHydration.buildMlAttributesPayload(hydratedValues, mlSchema);
    const serverAttrsAlreadySaved = this.mlHydration.productHasSavedMlAttrsForCategory(
      product, marketplaceId, externalCategoryId,
    );

    return {
      externalCategoryId,
      schema: { required, optional },
      hydratedValues,
      missing,
      attributesPayload,
      serverAttrsAlreadySaved,
    };
  }
}
