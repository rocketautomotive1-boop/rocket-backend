import { computeDirect } from './cost-engine';

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
