export type ListingTypeId = 'gold_special' | 'gold_pro';
export type LogisticType =
  | 'fulfillment' | 'cross_docking' | 'xd_drop_off' | 'drop_off' | 'self_service';
export type CostLineKey = 'cost' | 'commission' | 'shipping' | 'tax' | 'opex';
export type ViabilityStatus = 'loss' | 'tight' | 'viable';
export type CostLineSource = 'input' | 'live' | 'config' | 'estimate';

export interface CostLine {
  key: CostLineKey;
  label: string;
  amount: number;
  pct: number; // fração de salePrice (0..1)
  source: CostLineSource;
}

/** Entradas já resolvidas (comissão/frete/fiscal/custo já buscados via portas) para a engine pura. */
export interface EngineInputs {
  cost: number;              // custo unitário do produto (via PRODUCT_DATA_PORT)
  saleFeeAmount: number;     // comissão absoluta para o preço-âncora (modo direto)
  commissionRate: number;    // percentage_fee/100 (para modo reverso)
  shipping: number;          // frete absoluto
  taxRate: number;           // alíquota fiscal sobre a venda (0 se impostos off)
  opexPerUnit: number;       // custos operacionais por unidade
}

export interface DirectResult {
  salePrice: number;
  breakdown: CostLine[];
  netProfit: number;
  marginPct: number;
  status: ViabilityStatus;
}

export interface ReverseResult {
  targetMargin: number;
  suggestedPrice: number | null; // null = inatingível
  warning?: string;
}

export const VIABILITY_TIGHT_THRESHOLD = 0.08;
