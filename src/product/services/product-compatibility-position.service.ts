import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import { resolvePositionMatch } from '../utils/ml-position-match.util';

@Injectable()
export class ProductCompatibilityPositionService {
  private readonly logger = new Logger(ProductCompatibilityPositionService.name);

  constructor(
    @InjectModel('ProductCompatibilityModel') private readonly compatModel: Model<any>,
    @InjectModel('ProductModel') private readonly productModel: Model<any>,
    @InjectModel('CategoryModel') private readonly categoryModel: Model<any>,
    private readonly mlCompatAdapter: MercadoLivreCompatibilityAdapter,
    private readonly configCache: MarketplaceConfigCacheService,
  ) {}

  /**
   * Resolve mlCatalogProductId/position/sidePosition para UMA linha de
   * product_compatibilities, via /products/search por marca+partNumber. Nunca
   * lança — falta de dado suficiente ou ambiguidade vira positionNeedsReview.
   */
  async resolveForCompatibility(compatibilityId: string): Promise<void> {
    const compat = await this.compatModel.findById(compatibilityId).lean().exec();
    if (!compat) return;

    const product = await this.productModel.findById(compat.productId).lean().exec();
    const partNumber = product?.partNumber;
    const brandName = product?.brand?.name;

    if (!partNumber || !brandName) {
      await this.compatModel.findByIdAndUpdate(compatibilityId, { $set: { positionNeedsReview: true } });
      return;
    }

    const categoryId = await this.resolveMlCategoryId(product?.category);
    if (!categoryId) {
      await this.compatModel.findByIdAndUpdate(compatibilityId, { $set: { positionNeedsReview: true } });
      return;
    }

    const results = await this.mlCompatAdapter.searchCatalogProductsByPartNumber(
      brandName,
      partNumber,
      categoryId,
    );
    const match = resolvePositionMatch(results, partNumber);

    if (!match.catalogProductId) {
      await this.compatModel.findByIdAndUpdate(compatibilityId, { $set: { positionNeedsReview: true } });
      return;
    }

    // Já temos os atributos do candidato retornado por /products/search, mas
    // buscamos /products/{id} para garantir o shape completo (search pode omitir
    // atributos em alguns domínios) — mesma fonte usada na investigação ao vivo.
    const fullProduct = await this.mlCompatAdapter.getCatalogProduct(match.catalogProductId);
    const finalMatch = fullProduct
      ? resolvePositionMatch([fullProduct as any], partNumber)
      : match;

    await this.compatModel.findByIdAndUpdate(compatibilityId, {
      $set: {
        mlCatalogProductId: finalMatch.catalogProductId ?? match.catalogProductId,
        position: finalMatch.position,
        positionName: finalMatch.positionName,
        sidePosition: finalMatch.sidePosition,
        sidePositionName: finalMatch.sidePositionName,
        positionNeedsReview: false,
      },
    });
  }

  /**
   * Elegibilidade para publicar via catalog listing (Fase 2): elegível somente se o
   * produto tiver ao menos 1 linha product_compatibilities sincronizada, TODAS convergindo
   * para o mesmo mlCatalogProductId, e NENHUMA com positionNeedsReview pendente. Puro sobre
   * as linhas — não sabe de domínio ML piloto nem de listing (responsabilidade do caller).
   */
  async computeCatalogEligibility(
    productId: string,
  ): Promise<{ eligible: boolean; catalogProductId: string | null }> {
    const rows = await this.compatModel
      .find({ productId, syncedWithMarketplace: true })
      .select('mlCatalogProductId positionNeedsReview')
      .lean()
      .exec();

    if (!rows.length) return { eligible: false, catalogProductId: null };
    if (rows.some((r: any) => r.positionNeedsReview)) {
      return { eligible: false, catalogProductId: null };
    }

    const catalogProductIds = new Set(rows.map((r: any) => r.mlCatalogProductId));
    const allResolvedToSameId = catalogProductIds.size === 1 && !catalogProductIds.has(undefined) && !catalogProductIds.has(null);
    if (!allResolvedToSameId) {
      return { eligible: false, catalogProductId: null };
    }

    return { eligible: true, catalogProductId: [...catalogProductIds][0] as string };
  }

  private async resolveMlCategoryId(categoryRef: any): Promise<string | null> {
    if (!categoryRef) return null;
    const id = String(categoryRef);
    if (!Types.ObjectId.isValid(id)) return null;

    const category = await this.categoryModel.findById(id).lean().exec();
    if (!category) return null;

    const mlMarketplace = await this.configCache.getByName('Mercado Livre');
    if (!mlMarketplace) return null;

    const mapping = (category.marketplaceMappings ?? []).find(
      (m: any) => String(m.marketplaceId) === String(mlMarketplace._id),
    );
    return mapping?.externalId ? String(mapping.externalId) : null;
  }
}
