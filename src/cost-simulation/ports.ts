import { ListingTypeId, LogisticType } from './cost-simulation.types';

// ── Tokens DI (string tokens, mesmo padrão de order.module 'PRICING_STRATEGIES') ──
export const MARKETPLACE_FEES_PORT = 'MARKETPLACE_FEES_PORT';
export const FISCAL_RATE_PORT = 'FISCAL_RATE_PORT';
export const PRODUCT_DATA_PORT = 'PRODUCT_DATA_PORT';

// ── Contratos ──
export interface Commission {
  saleFeeAmount: number;   // valor absoluto da comissão p/ aquele preço
  commissionRate: number;  // percentage_fee / 100 (0..1)
  fixedFee: number;        // taxa fixa (live; hoje 0)
  listingTypeId: string;
}

export interface MarketplaceFeesPort {
  resolveSellerId(): Promise<string | null>;
  getCommission(params: { price: number; listingTypeId: ListingTypeId; categoryId?: string }): Promise<Commission>;
  /** Retorna 0 quando não há dimensões/seller (caller marca a linha como 'estimate'). */
  getShipping(params: { sellerId: string; dimensions?: string; logisticType: LogisticType }): Promise<number>;
}

export interface FiscalRate {
  rate: number;            // alíquota efetiva (0..1)
  taxRegime: string | null;
}

export interface FiscalRatePort {
  getRate(override?: number): Promise<FiscalRate>;
}

/** Dados do produto que o simulador precisa resolver automaticamente (1 leitura). */
export interface ProductData {
  cost: number;                 // costPrice/avgCost (0 se indisponível)
  categoryId: string | null;    // externalId ML resolvido de category.marketplaceMappings (ex.: MLB44379)
  dimensions: string | null;    // "CxLxA,pesoG" pronto p/ shipping_options; null se faltar peso/dim
}

export interface ProductDataPort {
  /** Resolve custo + categoria ML + dimensões/peso do produto numa única leitura. */
  getProductData(productId: string): Promise<ProductData>;
}
