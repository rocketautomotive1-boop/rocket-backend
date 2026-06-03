import { computeStockReconciliation } from './compute-stock-reconciliation';

describe('computeStockReconciliation', () => {
  it('first projection (no movements): inbound of the full target qty', () => {
    expect(computeStockReconciliation(10, 0)).toEqual({ type: 'inbound', quantity: 10 });
  });

  it('target already matches derived: no movement', () => {
    expect(computeStockReconciliation(10, 10)).toBeNull();
  });

  it('target higher than derived: positive adjustment of the delta', () => {
    expect(computeStockReconciliation(15, 10)).toEqual({ type: 'adjustment', quantity: 5 });
  });

  it('target lower than derived: negative adjustment of the delta', () => {
    expect(computeStockReconciliation(7, 10)).toEqual({ type: 'adjustment', quantity: -3 });
  });

  it('target zero from zero: no movement', () => {
    expect(computeStockReconciliation(0, 0)).toBeNull();
  });

  it('treats missing/NaN target as 0', () => {
    expect(computeStockReconciliation(undefined as any, 0)).toBeNull();
    expect(computeStockReconciliation(undefined as any, 5)).toEqual({ type: 'adjustment', quantity: -5 });
  });
});
