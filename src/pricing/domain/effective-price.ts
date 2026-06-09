import { isNewCondition } from './condition';

export interface PriceOverride {
  marketplaceId: string;
  price: number;
}

export interface ConditionPrice {
  condition: string;
  price: number;
}

export interface ConditionOverride {
  condition: string;
  marketplaceId: string;
  price: number;
}

/**
 * Effective sale price for a (marketplace, condition).
 * - 'new' (or omitted): marketplace override (>0) else basePrice (>0) else null — unchanged behavior.
 * - non-new: condition override for (condition, marketplace) (>0) else conditionPrice for condition
 *   (>0) else null. NEVER falls back to basePrice — a non-new offer with no price must not publish.
 * A zero is never a valid price (we never publish at 0/cost).
 */
export function resolveEffectivePrice(
  basePrice: number | null | undefined,
  overrides: PriceOverride[],
  marketplaceId: string | undefined,
  conditionPrices: ConditionPrice[] = [],
  conditionOverrides: ConditionOverride[] = [],
  condition?: string,
): number | null {
  if (isNewCondition(condition)) {
    if (marketplaceId) {
      const o = (overrides ?? []).find((x) => String(x.marketplaceId) === String(marketplaceId));
      if (o && o.price > 0) return o.price;
    }
    return basePrice && basePrice > 0 ? basePrice : null;
  }

  if (marketplaceId) {
    const co = (conditionOverrides ?? []).find(
      (x) => x.condition === condition && String(x.marketplaceId) === String(marketplaceId),
    );
    if (co && co.price > 0) return co.price;
  }
  const cp = (conditionPrices ?? []).find((x) => x.condition === condition);
  return cp && cp.price > 0 ? cp.price : null;
}
