export class OrderItemPricingDto {
  externalId?: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;

  // Calculated fields
  grossProfit: number; // (unitPrice - costPrice) * quantity
  profitMarginPercent: number; // (grossProfit / (unitPrice * quantity)) * 100

  commissionAmount: number; // Comissão do marketplace
  commissionRate: number; // Taxa de comissão em %

  taxAmount: number; // Impostos retidos
  taxRate: number; // Taxa de imposto em %

  freightAmount: number; // Rateio de frete por item

  netProfit: number; // grossProfit - commission - taxes - freight
  netMarginPercent: number; // (netProfit / (unitPrice * quantity)) * 100
}

export class OrderPricingTotalsDto {
  // Revenue
  grossRevenue: number; // Total de vendas antes de custos

  // Costs breakdown
  totalCostOfGoods: number; // Custo total dos produtos
  totalCommission: number; // Comissão total do marketplace
  totalTaxes: number; // Impostos totais retidos
  totalFreight: number; // Frete total
  totalOtherCosts: number; // Cupons, descontos, etc

  // Profit
  totalGrossProfit: number; // Lucro bruto (receita - custo de produtos)
  totalNetProfit: number; // Lucro líquido (após todas as deduções)

  // Metrics
  avgCostPrice: number; // Custo médio por unidade
  avgSellingPrice: number; // Preço médio de venda por unidade
  profitMarginPercent: number; // Margem de lucro líquido %
}

export class OrderPricingDetailDto {
  orderId: string;
  externalId: string;
  marketplace: string;
  createdAt: Date;

  items: OrderItemPricingDto[];
  totals: OrderPricingTotalsDto;

  // Metadata
  strategy: string; // Nome do marketplace calculator usado (e.g., 'MERCADOLIVRE')
  calculatedAt: Date;
}
