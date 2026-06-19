import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductTitleService } from '../../product/services/product-title.service';
import { MercadoLivreService } from '../../marketplace/services/mercado-livre.service';
import { ProductService } from '../../product/product.service';

const NEGATIVE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class QuestionProductResolver {
  private readonly logger = new Logger(QuestionProductResolver.name);
  private positive = new Map<string, string>();
  private negative = new Map<string, number>();

  constructor(
    private readonly productTitleService: ProductTitleService,
    private readonly mercadoLivreService: MercadoLivreService,
    private readonly productService: ProductService,
  ) {}

  async resolve(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null> {
    if (!itemId) return null;
    const key = `${marketplace._id}:${itemId}`;

    const cached = this.positive.get(key);
    if (cached) return new Types.ObjectId(cached);

    const negExpiry = this.negative.get(key);
    if (negExpiry && negExpiry > Date.now()) return null;
    if (negExpiry) this.negative.delete(key);

    const resolved = await this.doResolve(itemId, marketplace, token);
    if (resolved) {
      this.positive.set(key, resolved.toString());
      return resolved;
    }
    this.negative.set(key, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  /** Listing match → numeric/MLB fallback → getItem+SKU auto-link. Lifted from QuestionsService.resolveProductId. */
  private async doResolve(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null> {
    let pm = await this.productTitleService.findByExternalIdAndMarketplaceId(itemId, marketplace._id);

    if (!pm) {
      const numericId = itemId.replace(/\D/g, '');
      if (numericId && numericId !== itemId) {
        pm = await this.productTitleService.findByExternalIdAndMarketplaceId(numericId, marketplace._id);
        if (!pm) {
          const mlbId = `MLB${numericId}`;
          if (mlbId !== itemId) {
            pm = await this.productTitleService.findByExternalIdAndMarketplaceId(mlbId, marketplace._id);
          }
        }
      }
    }

    if (!pm) {
      try {
        const itemDetails = await this.mercadoLivreService.getItem(itemId, token);
        const sku = itemDetails.seller_custom_field ||
          itemDetails.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;
        if (sku) {
          const localProduct = await this.productService.findByBarcode(sku);
          if (localProduct) {
            pm = await this.productTitleService.create(String(localProduct._id), {
              marketplaceId: marketplace._id,
              externalId: itemId,
              syncStatus: itemDetails.status === 'active' ? 'synced' : 'paused',
              marketplaceData: {
                permalink: itemDetails.permalink,
                price: itemDetails.price,
                title: itemDetails.title,
              },
            });
          }
        }
      } catch (e) {
        this.logger.error(`[Resolve] Auto-Link failed for ${itemId}: ${(e as Error).message}`);
      }
    }

    if (pm?.product?.id) return new Types.ObjectId(pm.product.id);
    return null;
  }
}
