import { computeDirect, computeReverse } from './cost-engine';

describe('computeDirect', () => {
  it('decompõe o preço e calcula lucro/margem/viabilidade', () => {
    const r = computeDirect(99, {
      cost: 35, saleFeeAmount: 12, commissionRate: 0.12,
      shipping: 19, taxRate: 0.06, opexPerUnit: 0,
    });
    // 99 - 35 - 12 - 19 - (99*0.06)=5.94 = 27.06
    expect(r.netProfit).toBeCloseTo(27.06, 2);
    expect(r.marginPct).toBeCloseTo(27.06 / 99, 4);
    expect(r.status).toBe('viable');
    const keys = r.breakdown.map((l) => l.key);
    expect(keys).toEqual(['cost', 'commission', 'shipping', 'tax', 'opex']);
    expect(r.breakdown.find((l) => l.key === 'tax')!.amount).toBeCloseTo(5.94, 2);
  });

  it('marca prejuízo quando custos superam o preço', () => {
    const r = computeDirect(40, {
      cost: 35, saleFeeAmount: 6, commissionRate: 0.12,
      shipping: 10, taxRate: 0, opexPerUnit: 0,
    });
    expect(r.netProfit).toBeLessThan(0);
    expect(r.status).toBe('loss');
  });

  it('marca apertado entre 0 e 8%', () => {
    const r = computeDirect(100, {
      cost: 80, saleFeeAmount: 12, commissionRate: 0.12,
      shipping: 3, taxRate: 0, opexPerUnit: 0,
    });
    // 100-80-12-3 = 5 → 5%
    expect(r.status).toBe('tight');
  });
});

describe('computeReverse', () => {
  it('resolve o preço para a margem-alvo', () => {
    // Pv = (cost + shipping + opex) / (1 - commissionRate - taxRate - margin)
    // = (35 + 19 + 0) / (1 - 0.12 - 0.06 - 0.15) = 54 / 0.67 = 80.597
    const r = computeReverse(0.15, {
      cost: 35, saleFeeAmount: 0, commissionRate: 0.12,
      shipping: 19, taxRate: 0.06, opexPerUnit: 0,
    });
    expect(r.suggestedPrice).toBeCloseTo(80.6, 1);
    expect(r.warning).toBeUndefined();
  });

  it('retorna inatingível quando taxas + margem >= 100%', () => {
    const r = computeReverse(0.9, {
      cost: 35, saleFeeAmount: 0, commissionRate: 0.12,
      shipping: 19, taxRate: 0.06, opexPerUnit: 0,
    });
    expect(r.suggestedPrice).toBeNull();
    expect(r.warning).toMatch(/inating/i);
  });
});
