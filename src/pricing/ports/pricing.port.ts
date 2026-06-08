export const PRICING_PORT = Symbol('PRICING_PORT');

export interface ProductPricingView {
  productId: string;
  basePrice: number;
  overrides: Array<{ marketplaceId: string; price: number }>;
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
  setBasePrice(productId: string, price: number): Promise<void>;
  setOverride(productId: string, marketplaceId: string, price: number): Promise<void>;
  clearOverride(productId: string, marketplaceId: string): Promise<void>;
  setPricingMeta(
    productId: string,
    meta: { markup?: number; profitMargin?: number; strategy?: string; listPrice?: number },
  ): Promise<void>;
}
