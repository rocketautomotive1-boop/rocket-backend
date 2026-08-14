export const PRICING_PORT = Symbol('PRICING_PORT');

export interface ProductPricingView {
  productId: string;
  basePrice: number;
  overrides: Array<{ marketplaceId: string; price: number }>;
  /** Preço "de" da promoção vigente (undefined se não há promoção ou já expirou). */
  listPrice?: number;
  meta?: { markup?: number; profitMargin?: number; strategy?: string };
}

/**
 * The sale-price domain port. Single owner of sale price; consumers (product/publication) read
 * via this token and never touch product.price. Cost is NOT here (lives on the stock lot).
 */
export interface PricingPort {
  getBasePrice(productId: string): Promise<number>;
  /** Effective sale price for a marketplace (override>base); null when none → do not publish. */
  getEffectivePrice(productId: string, marketplaceId?: string): Promise<number | null>;
  getPricing(productId: string): Promise<ProductPricingView | null>;
  /** Batch read for list rendering — avoids N+1 when attaching prices to a product list. */
  getBasePrices(productIds: string[]): Promise<Map<string, number>>;
  /** Batch read incluindo listPrice de promoção vigente — usado pelos rails da home. */
  getPricings(productIds: string[]): Promise<Map<string, ProductPricingView>>;
  setBasePrice(productId: string, price: number): Promise<void>;
  setOverride(productId: string, marketplaceId: string, price: number): Promise<void>;
  clearOverride(productId: string, marketplaceId: string): Promise<void>;
  setPricingMeta(
    productId: string,
    meta: { markup?: number; profitMargin?: number; strategy?: string },
  ): Promise<void>;
  /** Preço "de-por" com vigência explícita — endsAt deve ser > startsAt, listPrice > preço base atual. */
  setPromotion(productId: string, promotion: { listPrice: number; startsAt: Date; endsAt: Date }): Promise<void>;
  clearPromotion(productId: string): Promise<void>;
  /** IDs de produto com promoção vigente agora — usado pelo rail "deals". */
  getActivePromotionProductIds(): Promise<string[]>;
}
