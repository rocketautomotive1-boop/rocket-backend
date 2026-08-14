export const PRODUCT_RESOLVER_PORT = Symbol('PRODUCT_RESOLVER_PORT');

export interface ResolveItemInput {
  externalItemId: string;
  sku: string;
  title?: string;
}

export interface ProductResolverPort {
  /** Resolve an internal product _id (string) from external identifiers. Null if unresolved. */
  resolveProduct(
    externalItemId: string,
    sku: string,
    marketplaceId?: string,
    title?: string,
  ): Promise<string | null>;

  /** Batch resolve — returns a Map keyed by input index → product _id (or null). */
  resolveProducts(
    items: ResolveItemInput[],
    marketplaceId: string,
  ): Promise<Map<number, string | null>>;

  /** Batch fetch costPrice by product _id. Returns Map productId → costPrice (0 if unknown). */
  getCostPrices(productIds: string[]): Promise<Map<string, number>>;
}
