import { Inject, Injectable } from '@nestjs/common';
import { computeDirect, computeReverse } from './cost-engine';
import { CostLine, EngineInputs, ListingTypeId, LogisticType } from './cost-simulation.types';
import {
  MARKETPLACE_FEES_PORT, FISCAL_RATE_PORT, PRODUCT_DATA_PORT,
  MarketplaceFeesPort, FiscalRatePort, ProductDataPort,
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
  taxRate?: number;          // override da alíquota efetiva (0..1); senão usa FiscalIssuer
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
    @Inject(PRODUCT_DATA_PORT) private readonly product: ProductDataPort,
  ) {}

  async preview(input: PreviewInput): Promise<PreviewResult> {
    const warnings: string[] = [];
    const anchor = input.salePrice ?? 0;

    // Resolve dados do produto (custo + categoria ML + dimensões) numa leitura.
    const pdata = await this.product.getProductData(input.productId);

    // custo: override do frontend tem prioridade; senão do produto
    const cost = (input.cost != null && input.cost > 0) ? input.cost : pdata.cost;
    if (cost === 0) warnings.push('Custo do produto 0 — registre uma entrada de estoque com custo.');

    // categoria ML: override do input; senão resolvida do produto
    const categoryId = input.categoryId ?? pdata.categoryId ?? undefined;
    // dimensões: override do input; senão do produto
    const dimensions = input.dimensions ?? pdata.dimensions ?? undefined;

    const sellerId = await this.fees.resolveSellerId();
    const commission = await this.fees.getCommission({
      price: anchor > 0 ? anchor : 100, // âncora p/ reverso
      listingTypeId: input.listingTypeId,
      categoryId,
    });

    let shipping = 0;
    if (dimensions && sellerId) {
      shipping = await this.fees.getShipping({ sellerId, dimensions, logisticType: input.logisticType });
      if (shipping === 0) warnings.push('Frete estimado em R$0 (verifique dimensões/peso).');
    } else {
      warnings.push('Frete não calculado: informe o peso do produto.');
    }

    let taxRate = 0;
    let taxRegime: string | null = null;
    if (input.includeTax) {
      const f = await this.fiscal.getRate(input.taxRate);
      taxRate = f.rate;
      taxRegime = f.taxRegime;
      if (taxRate === 0) warnings.push('Alíquota fiscal 0 — informe a alíquota efetiva (%) no simulador ou no cadastro fiscal.');
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
      categoryId: categoryId ?? null,
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
