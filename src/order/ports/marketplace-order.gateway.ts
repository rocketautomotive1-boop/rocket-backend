export const MARKETPLACE_ORDER_GATEWAY = Symbol('MARKETPLACE_ORDER_GATEWAY');

/** Raw external order as returned by a marketplace adapter (StandardOrder-shaped). */
export interface ExternalOrder {
  id: string;
  marketplaceId: string;
  marketplaceName?: string;
  status: string;
  date_created: string;
  date_last_updated?: string;
  total_amount: number;
  [key: string]: any;
}

/** Lightweight delta entry for reconcile (no enrichment). */
export interface ExternalOrderRef {
  id: string;
  status: string;
  date_last_updated: string;
}

export interface MarketplaceOrderGateway {
  /** Fetch a single order's full detail from the marketplace API. Returns null if not found. */
  fetchOrder(externalId: string, marketplaceId: string): Promise<ExternalOrder | null>;

  /**
   * List orders updated at the marketplace strictly after `cursor` (high-water mark on
   * date_last_updated), oldest-first. Adapters lacking incremental filter degrade to a
   * sliding window internally. Returns [] if none.
   */
  listOrdersSince(marketplaceId: string, cursor: Date): Promise<ExternalOrderRef[]>;

  /** Fetch raw billing info JSON for a billing id (marketplace-specific). */
  getBillingInfo(billingId: string, marketplaceId: string): Promise<any>;
}
