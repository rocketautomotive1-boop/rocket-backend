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

    const ml = internalCategory && mlMarketplace
      ? await this.buildMlState(product, internalCategory, String(mlMarketplace._id))
      : null;

    return {
      productId: String(productId),
      product,
      internalCategory,
      discovery: { resolvedCategoryId, resolvedCategory, mlCategoryId },
      ml,
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
    hydratedCategory: HydratedCategoryDto,
    marketplaceId: string,
  ): Promise<MlSnapshotStateDto | null> {
    const mapping = (hydratedCategory.marketplaceMappings ?? []).find(
      (m: any) => String(m.marketplaceId) === marketplaceId,
    );
    const externalCategoryId = String(
      mapping?.externalId
        ?? mapping?.id
        ?? mapping?.categoryResult?.category_id
        ?? '',
    ).trim();
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
