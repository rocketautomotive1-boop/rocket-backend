import { CostSimulationService } from './cost-simulation.service';
import { MarketplaceFeesPort, FiscalRatePort, ProductDataPort } from './ports';

const mkSvc = () => {
  const fees: jest.Mocked<MarketplaceFeesPort> = {
    resolveSellerId: jest.fn().mockResolvedValue('2417879606'),
    resolveReputation: jest.fn().mockResolvedValue('red'),
    getCommission: jest.fn().mockResolvedValue({ saleFeeAmount: 12, commissionRate: 0.12, fixedFee: 0, listingTypeId: 'gold_special' }),
    getShipping: jest.fn().mockResolvedValue(19),
  };
  const fiscal: jest.Mocked<FiscalRatePort> = {
    getRate: jest.fn().mockResolvedValue({ rate: 0.06, taxRegime: 'SIMPLES_NACIONAL' }),
  };
  const product: jest.Mocked<ProductDataPort> = {
    getProductData: jest.fn().mockResolvedValue({ cost: 35, categoryId: 'MLB44379', weightKg: 0.3 }),
  };
  return { svc: new CostSimulationService(fees, fiscal, product), fees, fiscal, product };
};

describe('CostSimulationService.preview', () => {
  it('modo direto: compõe portas e devolve breakdown + viabilidade', async () => {
    const { svc } = mkSvc();
    const r = await svc.preview({
      productId: 'p1', salePrice: 99,
      listingTypeId: 'gold_special', logisticType: 'drop_off',
      includeTax: true,
    });
    expect(r.netProfit).toBeCloseTo(27.06, 2);
    expect(r.status).toBe('viable');
    expect(r.meta.taxRegime).toBe('SIMPLES_NACIONAL');
  });

  it('usa custo do produto (ProductDataPort) quando não há override', async () => {
    const { svc, product } = mkSvc();
    const r = await svc.preview({ productId: 'p1', salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false });
    expect(product.getProductData).toHaveBeenCalledWith('p1');
    expect(r.breakdown.find((l) => l.key === 'cost')!.amount).toBe(35);
  });

  it('resolve categoria ML e peso do produto automaticamente', async () => {
    const { svc, fees } = mkSvc();
    await svc.preview({ productId: 'p1', salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false });
    expect(fees.getCommission).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'MLB44379' }));
    expect(fees.getShipping).toHaveBeenCalledWith(expect.objectContaining({ weightKg: 0.3, reputation: 'red' }));
  });

  it('override de custo (frontend) tem prioridade sobre o produto', async () => {
    const { svc } = mkSvc();
    const r = await svc.preview({ productId: 'p1', cost: 50, salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false });
    expect(r.breakdown.find((l) => l.key === 'cost')!.amount).toBe(50);
  });

  it('impostos desligados → não chama fiscal e taxRate 0', async () => {
    const { svc, fiscal } = mkSvc();
    const r = await svc.preview({ productId: 'p1', salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false });
    expect(fiscal.getRate).not.toHaveBeenCalled();
    expect(r.breakdown.find((l) => l.key === 'tax')!.amount).toBe(0);
  });

  it('modo reverso: devolve suggestion', async () => {
    const { svc } = mkSvc();
    const r = await svc.preview({ productId: 'p1', targetMargin: 0.15, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: true });
    expect(r.suggestion?.suggestedPrice).toBeGreaterThan(0);
  });
});
