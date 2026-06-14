import { Inject, Injectable } from '@nestjs/common';
import { computeDirect, computeReverse } from './cost-engine';
import { CostLine, EngineInputs, ListingTypeId, LogisticType } from './cost-simulation.types';
import {
  MARKETPLACE_FEES_PORT, FISCAL_RATE_PORT, STOCK_COST_PORT,
  MarketplaceFeesPort, FiscalRatePort, StockCostPort,
} from './ports';

export interface PreviewInput {
  productId: string;
  cost?: number;             // override opcional (frontend já tem avgCost)
  salePrice?: number;
  targetMargin?: number;
  listingTypeId: ListingTypeId;
  logisticType: LogisticType;
  categoryId?: string;
  includeTax: boolean;
  opexPerUnit?: number;
  dimensions?: string;
}

export interface PreviewResult {
  salePrice: number;
  breakdown: CostLine[];
  netProfit: number;
  marginPct: number;
  status: string;
  suggestion?: { targetMargin: number; suggestedPrice: number | null; warning?: string };
  meta: { listingTypeId: string; logisticType: string; categoryId: string | null; taxRegime: string | null; warnings: string[] };
}

@Injectable()
export class CostSimulationService {
  constructor(
    @Inject(MARKETPLACE_FEES_PORT) private readonly fees: MarketplaceFeesPort,
    @Inject(FISCAL_RATE_PORT) private readonly fiscal: FiscalRatePort,
    @Inject(STOCK_COST_PORT) private readonly stock: StockCostPort,
  ) {}

  async preview(input: PreviewInput): Promise<PreviewResult> {
    const warnings: string[] = [];
    const anchor = input.salePrice ?? 0;

    // custo: override do frontend tem prioridade; senão via porta
    const cost = (input.cost != null && input.cost > 0)
      ? input.cost
      : await this.stock.getUnitCost(input.productId);
    if (cost === 0) warnings.push('Custo do produto 0 — registre uma entrada de estoque com custo.');

    const sellerId = await this.fees.resolveSellerId();
    const commission = await this.fees.getCommission({
      price: anchor > 0 ? anchor : 100, // âncora p/ reverso
      listingTypeId: input.listingTypeId,
      categoryId: input.categoryId,
    });

    let shipping = 0;
    if (input.dimensions && sellerId) {
      shipping = await this.fees.getShipping({ sellerId, dimensions: input.dimensions, logisticType: input.logisticType });
      if (shipping === 0) warnings.push('Frete estimado em R$0 (verifique dimensões/peso).');
    } else {
      warnings.push('Frete não calculado: faltam dimensões/peso ou conta ML.');
    }

    let taxRate = 0;
    let taxRegime: string | null = null;
    if (input.includeTax) {
      const f = await this.fiscal.getRate();
      taxRate = f.rate;
      taxRegime = f.taxRegime;
      if (taxRate === 0) warnings.push('Alíquota fiscal 0 — configure o regime/efetiva no cadastro fiscal.');
    }

    const engineInputs: EngineInputs = {
      cost,
      saleFeeAmount: commission.saleFeeAmount,
      commissionRate: commission.commissionRate,
      shipping,
      taxRate,
      opexPerUnit: input.opexPerUnit ?? 0,
    };

    const meta = {
      listingTypeId: commission.listingTypeId,
      logisticType: input.logisticType,
      categoryId: input.categoryId ?? null,
      taxRegime,
      warnings,
    };

    if (input.targetMargin != null) {
      const reverse = computeReverse(input.targetMargin, engineInputs);
      const price = reverse.suggestedPrice ?? anchor;
      const direct = computeDirect(price, engineInputs);
      return { ...direct, suggestion: reverse, meta };
    }

    const direct = computeDirect(anchor, engineInputs);
    return { ...direct, meta };
  }
}
