import { CostSimulationService } from './cost-simulation.service';
import { MarketplaceFeesPort, FiscalRatePort, StockCostPort } from './ports';

const mkSvc = () => {
  const fees: jest.Mocked<MarketplaceFeesPort> = {
    resolveSellerId: jest.fn().mockResolvedValue('2417879606'),
    getCommission: jest.fn().mockResolvedValue({ saleFeeAmount: 12, commissionRate: 0.12, fixedFee: 0, listingTypeId: 'gold_special' }),
    getShipping: jest.fn().mockResolvedValue(19),
  };
  const fiscal: jest.Mocked<FiscalRatePort> = {
    getRate: jest.fn().mockResolvedValue({ rate: 0.06, taxRegime: 'SIMPLES_NACIONAL' }),
  };
  const stock: jest.Mocked<StockCostPort> = {
    getUnitCost: jest.fn().mockResolvedValue(35),
  };
  return { svc: new CostSimulationService(fees, fiscal, stock), fees, fiscal, stock };
};

describe('CostSimulationService.preview', () => {
  it('modo direto: compõe portas e devolve breakdown + viabilidade', async () => {
    const { svc } = mkSvc();
    const r = await svc.preview({
      productId: 'p1', salePrice: 99,
      listingTypeId: 'gold_special', logisticType: 'drop_off',
      includeTax: true, dimensions: '30x20x10,1000',
    });
    expect(r.netProfit).toBeCloseTo(27.06, 2);
    expect(r.status).toBe('viable');
    expect(r.meta.taxRegime).toBe('SIMPLES_NACIONAL');
  });

  it('usa custo via STOCK_COST_PORT quando não há override', async () => {
    const { svc, stock } = mkSvc();
    await svc.preview({ productId: 'p1', salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false, dimensions: '1x1x1,100' });
    expect(stock.getUnitCost).toHaveBeenCalledWith('p1');
  });

  it('override de custo (frontend) tem prioridade sobre a porta', async () => {
    const { svc, stock } = mkSvc();
    const r = await svc.preview({ productId: 'p1', cost: 50, salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false, dimensions: '1x1x1,100' });
    expect(stock.getUnitCost).not.toHaveBeenCalled();
    expect(r.breakdown.find((l) => l.key === 'cost')!.amount).toBe(50);
  });

  it('impostos desligados → não chama fiscal e taxRate 0', async () => {
    const { svc, fiscal } = mkSvc();
    const r = await svc.preview({ productId: 'p1', salePrice: 99, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: false, dimensions: '1x1x1,100' });
    expect(fiscal.getRate).not.toHaveBeenCalled();
    expect(r.breakdown.find((l) => l.key === 'tax')!.amount).toBe(0);
  });

  it('modo reverso: devolve suggestion', async () => {
    const { svc } = mkSvc();
    const r = await svc.preview({ productId: 'p1', targetMargin: 0.15, listingTypeId: 'gold_special', logisticType: 'drop_off', includeTax: true, dimensions: '1x1x1,100' });
    expect(r.suggestion?.suggestedPrice).toBeGreaterThan(0);
  });
});
