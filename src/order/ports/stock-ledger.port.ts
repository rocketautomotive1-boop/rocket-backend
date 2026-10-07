import { ClientSession } from 'mongoose';

export const STOCK_LEDGER_PORT = Symbol('STOCK_LEDGER_PORT');

export interface StockItem {
  productId: string;
  quantity: number;
  /**
   * Identificam o ANÚNCIO vendido. O ledger resolve a loja da movimentação por eles (a loja do
   * anúncio), não pela StoreListing "mais antiga" do produto — ver StoreOwnerLookupPort.
   */
  marketplaceId?: string;
  listingExternalId?: string;
}

export interface StockLedgerPort {
  /**
   * Deduct stock for an order within the GIVEN transaction session and return created
   * movement ids so the pipeline can link them atomically. Idempotent on `reference`.
   *
   * Runs inside the caller's transaction — StoreListing is the only stock store (Contract,
   * 2026-08-29), so this write IS the real deduction; there is no separate post-commit mirror
   * step anymore.
   */
  deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[]; items: StockItem[] }>;

  /** Revert (inbound) a cancelled order's items. Idempotent on `reference`. */
  revert(
    orderId: string,
    items: Array<StockItem & { unitPrice: number }>,
    reference: string,
  ): Promise<void>;

  /**
   * Deduct stock in its OWN transaction (no external session) and link movements to the order.
   * Used by the legacy ORDER_EVENTS.SYNCED path. Idempotent on `reference`.
   */
  deductStandalone(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
  ): Promise<{ status: string; movementsCount?: number; reason?: string }>;
}
