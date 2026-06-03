import { deriveGeneralCompletion } from './derive-general-completion';

const full = {
  domain: 'general',
  name: 'Vitamina C 1g',
  brand: { name: 'ACME' },
  price: '49.9',
  ncm: '21069030',
  images: [{ url: 'http://i/1.jpg' }],
};

describe('deriveGeneralCompletion', () => {
  it('all sections complete + readyToPublish when everything present', () => {
    expect(deriveGeneralCompletion(full)).toEqual({
      dados: true, imagens: true, precoEstoque: true, fiscal: true, readyToPublish: true,
    });
  });

  it('dados requires name AND brand', () => {
    expect(deriveGeneralCompletion({ ...full, brand: undefined }).dados).toBe(false);
    expect(deriveGeneralCompletion({ ...full, name: '  ' }).dados).toBe(false);
  });

  it('accepts brand.shortName for dados', () => {
    expect(deriveGeneralCompletion({ ...full, brand: { shortName: 'ACME' } }).dados).toBe(true);
  });

  it('precoEstoque requires price > 0 (string or number)', () => {
    expect(deriveGeneralCompletion({ ...full, price: 0 }).precoEstoque).toBe(false);
    expect(deriveGeneralCompletion({ ...full, price: 12.5 }).precoEstoque).toBe(true);
  });

  it('fiscal reads ncm top-level or tax.ncm', () => {
    expect(deriveGeneralCompletion({ ...full, ncm: undefined, tax: { ncm: '123' } }).fiscal).toBe(true);
    expect(deriveGeneralCompletion({ ...full, ncm: undefined }).fiscal).toBe(false);
  });

  it('imagens requires a non-empty array', () => {
    expect(deriveGeneralCompletion({ ...full, images: [] }).imagens).toBe(false);
  });

  it('readyToPublish false if any section missing', () => {
    expect(deriveGeneralCompletion({ ...full, images: [] }).readyToPublish).toBe(false);
  });

  it('tolerates null/empty product', () => {
    expect(deriveGeneralCompletion(null)).toEqual({
      dados: false, imagens: false, precoEstoque: false, fiscal: false, readyToPublish: false,
    });
  });
});
