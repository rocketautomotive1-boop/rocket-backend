import { Injectable } from '@nestjs/common';
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
    return {
      productId: String(doc.productId),
      basePrice: doc.basePrice != null ? Number(doc.basePrice.toString()) : 0,
      overrides: (doc.overrides ?? []).map((o: any) => ({
        marketplaceId: String(o.marketplaceId),
        price: Number(o.price.toString()),
      })),
      listPrice: doc.listPrice != null ? Number(doc.listPrice.toString()) : undefined,
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
    meta: { markup?: number; profitMargin?: number; strategy?: string; listPrice?: number },
  ): Promise<void> {
    const { listPrice, ...rest } = meta;
    await this.repo.upsertMeta(productId, rest, listPrice !== undefined ? dec(listPrice) : undefined);
  }
}
