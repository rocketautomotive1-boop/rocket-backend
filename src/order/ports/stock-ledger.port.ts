import { ClientSession } from 'mongoose';

export const STOCK_LEDGER_PORT = Symbol('STOCK_LEDGER_PORT');

export interface StockItem {
  productId: string;
  quantity: number;
}

export interface StockLedgerPort {
  /**
   * Deduct stock for an order within the GIVEN transaction session and return created
   * movement ids so the pipeline can link them atomically. Idempotent on `reference`.
   *
   * Runs inside the caller's transaction — the store-aware mirror (Fase 4) is intentionally
   * NOT written here (writing it now would be pre-commit, same risk the Fase 3 dual-write
   * already avoided). `items` is echoed back so the caller can invoke `mirrorAfterCommit`
   * once its own transaction has actually committed.
   */
  deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[]; items: StockItem[] }>;

  /**
   * Mirrors a previously-deducted order's items into the store-aware collections. Call this
   * ONLY after the caller's own transaction (the one passed to `deductAndLink`) has committed —
   * never before, and never if that transaction aborted. Fire-and-log: never throws.
   */
  mirrorAfterCommit(orderId: string, items: StockItem[]): Promise<void>;

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
