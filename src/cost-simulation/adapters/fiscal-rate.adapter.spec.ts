import { FiscalRateAdapter } from './fiscal-rate.adapter';

describe('FiscalRateAdapter.resolve', () => {
  it('usa effectiveTaxRate do issuer para Simples', () => {
    expect(FiscalRateAdapter.resolve({ taxRegime: 'SIMPLES_NACIONAL', effectiveTaxRate: 0.04 } as any, undefined)).toBeCloseTo(0.04, 4);
  });
  it('override explícito tem prioridade', () => {
    expect(FiscalRateAdapter.resolve({ taxRegime: 'SIMPLES_NACIONAL', effectiveTaxRate: 0.04 } as any, 0.07)).toBeCloseTo(0.07, 4);
  });
  it('0 quando não há issuer nem override', () => {
    expect(FiscalRateAdapter.resolve(null, undefined)).toBe(0);
  });
});
