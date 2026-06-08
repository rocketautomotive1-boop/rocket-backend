import { resolveEffectivePrice } from './effective-price';

describe('resolveEffectivePrice', () => {
  const overrides = [
    { marketplaceId: 'm1', price: 120 },
    { marketplaceId: 'm2', price: 90 },
  ];

  it('returns the marketplace override when present', () => {
    expect(resolveEffectivePrice(100, overrides, 'm1')).toBe(120);
  });
  it('falls back to basePrice when no override for the marketplace', () => {
    expect(resolveEffectivePrice(100, overrides, 'm3')).toBe(100);
  });
  it('falls back to basePrice when marketplaceId is undefined', () => {
    expect(resolveEffectivePrice(100, overrides, undefined)).toBe(100);
  });
  it('returns null when there is no base and no override', () => {
    expect(resolveEffectivePrice(0, [], 'm1')).toBeNull();
    expect(resolveEffectivePrice(null, [], 'm1')).toBeNull();
  });
  it('override of 0 is treated as no price → falls back to base', () => {
    expect(resolveEffectivePrice(100, [{ marketplaceId: 'm1', price: 0 }], 'm1')).toBe(100);
  });
  it('override 0 with no base → null (never publish at 0)', () => {
    expect(resolveEffectivePrice(0, [{ marketplaceId: 'm1', price: 0 }], 'm1')).toBeNull();
  });
});
