import {
  CostLine, DirectResult, EngineInputs, ReverseResult, ViabilityStatus,
  VIABILITY_TIGHT_THRESHOLD,
} from './cost-simulation.types';

const status = (margin: number): ViabilityStatus =>
  margin < 0 ? 'loss' : margin < VIABILITY_TIGHT_THRESHOLD ? 'tight' : 'viable';

export function computeDirect(salePrice: number, i: EngineInputs): DirectResult {
  const tax = i.taxRate > 0 ? salePrice * i.taxRate : 0;
  const netProfit = salePrice - i.cost - i.saleFeeAmount - i.shipping - tax - i.opexPerUnit;
  const marginPct = salePrice > 0 ? netProfit / salePrice : 0;

  const line = (key: CostLine['key'], label: string, amount: number, source: CostLine['source']): CostLine => ({
    key, label, amount,
    pct: salePrice > 0 ? amount / salePrice : 0,
    source,
  });

  const breakdown: CostLine[] = [
    line('cost', 'Custo do produto', i.cost, 'input'),
    line('commission', 'Comissão ML', i.saleFeeAmount, 'live'),
    line('shipping', 'Frete', i.shipping, 'live'),
    line('tax', 'Imposto', tax, 'config'),
    line('opex', 'Operacional', i.opexPerUnit, 'config'),
  ];

  return { salePrice, breakdown, netProfit, marginPct, status: status(marginPct) };
}

export function computeReverse(targetMargin: number, i: EngineInputs): ReverseResult {
  const denom = 1 - i.commissionRate - i.taxRate - targetMargin;
  if (denom <= 0) {
    return { targetMargin, suggestedPrice: null, warning: 'Margem inatingível com as taxas atuais.' };
  }
  const suggestedPrice = (i.cost + i.shipping + i.opexPerUnit) / denom;
  return { targetMargin, suggestedPrice: Math.round(suggestedPrice * 100) / 100 };
}
