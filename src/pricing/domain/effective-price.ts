export interface PriceOverride {
  marketplaceId: string;
  price: number;
}

/**
 * Effective sale price for a marketplace: the marketplace override (when > 0), else the base
 * price (when > 0), else null. A null result means "no valid price" → must not publish.
 * A zero is never a valid price (we never publish at 0/cost).
 */
export function resolveEffectivePrice(
  basePrice: number | null | undefined,
  overrides: PriceOverride[],
  marketplaceId: string | undefined,
): number | null {
  if (marketplaceId) {
    const o = (overrides ?? []).find((x) => String(x.marketplaceId) === String(marketplaceId));
    if (o && o.price > 0) return o.price;
  }
  return basePrice && basePrice > 0 ? basePrice : null;
}
