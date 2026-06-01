import { deriveCompletion } from './derive-completion';

describe('deriveCompletion', () => {
  it('returns all false for null/empty product', () => {
    expect(deriveCompletion(null)).toEqual({ dados: false, imagens: false, precoEstoque: false, fiscal: false });
    expect(deriveCompletion({})).toEqual({ dados: false, imagens: false, precoEstoque: false, fiscal: false });
  });

  it('dados true only when name AND brand.name present', () => {
    expect(deriveCompletion({ name: 'X' }).dados).toBe(false);
    expect(deriveCompletion({ name: 'X', brand: {} }).dados).toBe(false);
    expect(deriveCompletion({ name: 'X', brand: { name: 'Nestlé' } }).dados).toBe(true);
  });

  it('imagens true when at least one image', () => {
    expect(deriveCompletion({ images: [] }).imagens).toBe(false);
    expect(deriveCompletion({ images: [{ url: 'http://i/1.jpg' }] }).imagens).toBe(true);
  });

  it('precoEstoque true when price > 0 (string or number, Decimal128-as-string)', () => {
    expect(deriveCompletion({ price: 0 }).precoEstoque).toBe(false);
    expect(deriveCompletion({ price: '0' }).precoEstoque).toBe(false);
    expect(deriveCompletion({ price: 12.9 }).precoEstoque).toBe(true);
    expect(deriveCompletion({ price: '12.90' }).precoEstoque).toBe(true);
  });

  it('fiscal true when ncm is a non-empty string', () => {
    expect(deriveCompletion({ ncm: '' }).fiscal).toBe(false);
    expect(deriveCompletion({ ncm: '   ' }).fiscal).toBe(false);
    expect(deriveCompletion({ ncm: '18069000' }).fiscal).toBe(true);
  });

  it('combines independently', () => {
    const p = { name: 'X', brand: { name: 'B' }, images: [{ url: 'u' }], price: '5', ncm: '1' };
    expect(deriveCompletion(p)).toEqual({ dados: true, imagens: true, precoEstoque: true, fiscal: true });
  });
});
