import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { PricingRepository } from './pricing.repository';
import { PricingPort, ProductPricingView } from './ports/pricing.port';
import { resolveEffectivePrice } from './domain/effective-price';

const dec = (n: number) => Types.Decimal128.fromString(String(n ?? 0));

/**
 * Single owner of sale price (implements PricingPort — reads + writes). Cost is never here.
 */
@Injectable()
export class PricingService implements PricingPort {
  constructor(private readonly repo: PricingRepository) {}

  private view(doc: any): ProductPricingView | null {
    if (!doc) return null;
    const promotion = doc.promotion;
    const now = new Date();
    const promotionActive = promotion && promotion.startsAt <= now && promotion.endsAt >= now;

    return {
      productId: String(doc.productId),
      basePrice: doc.basePrice != null ? Number(doc.basePrice.toString()) : 0,
      overrides: (doc.overrides ?? []).map((o: any) => ({
        marketplaceId: String(o.marketplaceId),
        price: Number(o.price.toString()),
      })),
      listPrice: promotionActive ? Number(promotion.listPrice.toString()) : undefined,
      meta: doc.meta,
    };
  }

  async getPricing(productId: string): Promise<ProductPricingView | null> {
    return this.view(await this.repo.findByProduct(productId));
  }

  async getBasePrice(productId: string): Promise<number> {
    const v = await this.getPricing(productId);
    return v?.basePrice ?? 0;
  }

  async getBasePrices(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const docs = await this.repo.findByProducts(productIds);
    return new Map(docs.map((d: any) => [String(d.productId), d.basePrice != null ? Number(d.basePrice.toString()) : 0]));
  }

  async getPricings(productIds: string[]): Promise<Map<string, ProductPricingView>> {
    if (productIds.length === 0) return new Map();
    const docs = await this.repo.findByProducts(productIds);
    const map = new Map<string, ProductPricingView>();
    for (const doc of docs) {
      const v = this.view(doc);
      if (v) map.set(v.productId, v);
    }
    return map;
  }

  async getEffectivePrice(productId: string, marketplaceId?: string): Promise<number | null> {
    const v = await this.getPricing(productId);
    if (!v) return null;
    return resolveEffectivePrice(v.basePrice, v.overrides, marketplaceId);
  }

  async setBasePrice(productId: string, price: number): Promise<void> {
    await this.repo.upsertBase(productId, dec(price));
  }

  async setOverride(productId: string, marketplaceId: string, price: number): Promise<void> {
    await this.repo.upsertOverride(productId, marketplaceId, dec(price));
  }

  async clearOverride(productId: string, marketplaceId: string): Promise<void> {
    await this.repo.clearOverride(productId, marketplaceId);
  }

  async setPricingMeta(
    productId: string,
    meta: { markup?: number; profitMargin?: number; strategy?: string },
  ): Promise<void> {
    await this.repo.upsertMeta(productId, meta);
  }

  async setPromotion(
    productId: string,
    promotion: { listPrice: number; startsAt: Date; endsAt: Date },
  ): Promise<void> {
    if (promotion.endsAt <= promotion.startsAt) {
      throw new BadRequestException('endsAt deve ser posterior a startsAt');
    }
    const basePrice = await this.getBasePrice(productId);
    if (promotion.listPrice <= basePrice) {
      throw new BadRequestException('listPrice deve ser maior que o preço base atual');
    }
    await this.repo.upsertPromotion(productId, {
      listPrice: dec(promotion.listPrice),
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
    });
  }

  async clearPromotion(productId: string): Promise<void> {
    await this.repo.clearPromotion(productId);
  }

  async getActivePromotionProductIds(): Promise<string[]> {
    const docs = await this.repo.findActivePromotionProductIds();
    return docs.map((d: any) => String(d.productId));
  }
}
