import { nextInterval, maxCursor, isStatusDivergent, isShippingPossiblyStale, RECONCILE } from './reconcile-cursor';

describe('reconcile-cursor', () => {
  it('doubles interval on clean run, capped at ceiling', () => {
    expect(nextInterval(RECONCILE.FLOOR_MS, true)).toBe(RECONCILE.FLOOR_MS * 2);
    expect(nextInterval(RECONCILE.CEILING_MS, true)).toBe(RECONCILE.CEILING_MS);
  });

  it('resets interval to floor when a gap is found', () => {
    expect(nextInterval(RECONCILE.CEILING_MS, false)).toBe(RECONCILE.FLOOR_MS);
  });

  it('maxCursor returns latest date from refs, or fallback when empty', () => {
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(maxCursor([], fallback)).toEqual(fallback);
    const got = maxCursor(
      [
        { date_last_updated: '2026-06-01T00:00:00Z' },
        { date_last_updated: '2026-06-03T00:00:00Z' },
      ],
      fallback,
    );
    expect(got.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });

  it('isStatusDivergent compares case-insensitively', () => {
    expect(isStatusDivergent('Paid', 'paid')).toBe(false);
    expect(isStatusDivergent('paid', 'shipped')).toBe(true);
  });

  it('isShippingPossiblyStale: substatus não-terminal (buffered/invoice_pending/in_hub/undefined) precisa de refresh', () => {
    expect(isShippingPossiblyStale('buffered')).toBe(true);
    expect(isShippingPossiblyStale('invoice_pending')).toBe(true);
    expect(isShippingPossiblyStale('in_hub')).toBe(true);
    expect(isShippingPossiblyStale(undefined)).toBe(true);
  });

  it('isShippingPossiblyStale: substatus terminal (delivered/not_delivered/cancelled) não precisa de refresh', () => {
    expect(isShippingPossiblyStale('delivered')).toBe(false);
    expect(isShippingPossiblyStale('not_delivered')).toBe(false);
    expect(isShippingPossiblyStale('cancelled')).toBe(false);
    expect(isShippingPossiblyStale('DELIVERED')).toBe(false);
  });
});
