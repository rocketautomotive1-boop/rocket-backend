import { resolveEffectivePrice, ConditionPrice, ConditionOverride } from './effective-price';

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

describe('resolveEffectivePrice — condition dimension', () => {
  const base = 100;
  const overrides = [{ marketplaceId: 'mp1', price: 130 }];
  const conditionPrices: ConditionPrice[] = [{ condition: 'damaged', price: 80 }];
  const conditionOverrides: ConditionOverride[] = [{ condition: 'damaged', marketplaceId: 'mp1', price: 70 }];

  it("condition 'new' resolves exactly as before (override>base)", () => {
    expect(resolveEffectivePrice(base, overrides, 'mp1', conditionPrices, conditionOverrides, 'new')).toBe(130);
    expect(resolveEffectivePrice(base, overrides, 'mp2', conditionPrices, conditionOverrides, 'new')).toBe(100);
  });
  it('omitted condition behaves like new', () => {
    expect(resolveEffectivePrice(base, overrides, 'mp2', conditionPrices, conditionOverrides)).toBe(100);
  });
  it('damaged uses conditionOverride for that marketplace', () => {
    expect(resolveEffectivePrice(base, overrides, 'mp1', conditionPrices, conditionOverrides, 'damaged')).toBe(70);
  });
  it('damaged falls back to conditionPrice when no condition override', () => {
    expect(resolveEffectivePrice(base, overrides, 'mp2', conditionPrices, conditionOverrides, 'damaged')).toBe(80);
  });
  it('damaged with no condition price → null (never falls back to basePrice)', () => {
    expect(resolveEffectivePrice(base, overrides, 'mp2', [], [], 'damaged')).toBeNull();
  });
  it('damaged conditionPrice of 0 → null', () => {
    expect(resolveEffectivePrice(base, overrides, 'mp2', [{ condition: 'damaged', price: 0 }], [], 'damaged')).toBeNull();
  });
});
