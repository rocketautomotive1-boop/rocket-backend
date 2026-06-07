export const STOCK_QUERY_PORT = Symbol('STOCK_QUERY_PORT');

export interface ProductStockSummary {
  productId: string;
  onHand: number; // sum across lots/boxes
  reserved: number;
  available: number; // onHand - reserved
}

export interface ConditionBalance {
  condition: string;
  onHand: number;
  reserved: number;
}

export interface LocationBalance {
  boxId: string | null;
  onHand: number;
  reserved: number;
}

/**
 * Read side of stock, consumed by Product/Order/Marketplace via DI token. All reads come from
 * the materialized projection (O(1)) — never re-aggregating the ledger on the hot path.
 */
export interface StockQueryPort {
  getProductStock(productId: string): Promise<ProductStockSummary>;
  getByCondition(productId: string): Promise<ConditionBalance[]>;
  getByLocation(productId: string): Promise<LocationBalance[]>;
  /** Bulk available for many products (listings/dashboards). */
  getAvailableBulk(productIds: string[]): Promise<Map<string, number>>;
  /** Product ids whose total onHand >= min (replaces product.repository.getProductIdsWithMinStock). */
  getProductIdsWithMinStock(min: number): Promise<string[]>;
  /** Weighted-average cost across a product's lots (replaces Product.costPrice reads). */
  getProductCost(productId: string): Promise<number>;
}
