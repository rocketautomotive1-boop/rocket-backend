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
   */
  deductAndLink(
    orderId: string,
    items: StockItem[],
    reference: string,
    marketplaceName: string,
    session: ClientSession,
  ): Promise<{ movementIds: string[] }>;

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
