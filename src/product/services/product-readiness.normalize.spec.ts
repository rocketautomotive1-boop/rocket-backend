import { normalizeCompletedAt } from './product-readiness.normalize';

describe('normalizeCompletedAt', () => {
  it('returns null for null', () => {
    expect(normalizeCompletedAt(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeCompletedAt(undefined)).toBeNull();
  });

  it('returns null for an empty object (corrupted stored value)', () => {
    // This is the bug: Mongoose stored `{}` and `?? null` let it through,
    // causing "Cast to date failed for value {}".
    expect(normalizeCompletedAt({})).toBeNull();
  });

  it('returns null for an arbitrary non-date object', () => {
    expect(normalizeCompletedAt({ foo: 'bar' })).toBeNull();
  });

  it('returns the same Date instance for a valid Date', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(normalizeCompletedAt(d)).toEqual(d);
  });

  it('returns null for an invalid Date instance', () => {
    expect(normalizeCompletedAt(new Date('not-a-date'))).toBeNull();
  });

  it('parses a valid ISO date string into a Date', () => {
    const result = normalizeCompletedAt('2026-01-01T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null for an unparseable string', () => {
    expect(normalizeCompletedAt('garbage')).toBeNull();
  });

  it('parses a numeric epoch timestamp into a Date', () => {
    const ts = Date.UTC(2026, 0, 1);
    const result = normalizeCompletedAt(ts);
    expect(result).toBeInstanceOf(Date);
    expect(result?.getTime()).toBe(ts);
  });
});
