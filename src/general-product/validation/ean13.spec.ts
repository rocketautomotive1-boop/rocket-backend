// backend/src/general-product/validation/ean13.spec.ts
import { isValidEan13 } from './ean13';

describe('isValidEan13', () => {
  it('accepts a valid EAN-13 (check digit correct)', () => {
    expect(isValidEan13('7891000100103')).toBe(true);
  });

  it('rejects an EAN-13 with wrong check digit', () => {
    expect(isValidEan13('7891000100104')).toBe(false);
  });

  it('rejects strings that are not 13 digits', () => {
    expect(isValidEan13('123')).toBe(false);
    expect(isValidEan13('78910001001031')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidEan13('78910001001x3')).toBe(false);
  });

  it('rejects empty / nullish input', () => {
    expect(isValidEan13('')).toBe(false);
    expect(isValidEan13(undefined as unknown as string)).toBe(false);
  });
});
