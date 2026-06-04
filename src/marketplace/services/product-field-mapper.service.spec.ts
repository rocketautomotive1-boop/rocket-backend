import { ProductFieldMapper } from './product-field-mapper.service';

describe('ProductFieldMapper', () => {
  const mapper = new ProductFieldMapper();

  const baseProduct = (overrides: any = {}): any => ({
    name: 'Suplemento X',
    attributes: [],
    ...overrides,
  });

  describe('marca', () => {
    it('uses product.brand.name when present', () => {
      const out = mapper.map(baseProduct({ brand: { name: 'ACME' } }));
      expect(out.marca).toBe('ACME');
    });

    it('falls back to the BRAND attribute when product.brand is absent (general domain)', () => {
      const out = mapper.map(
        baseProduct({ attributes: [{ code: 'BRAND', value: 'Nicoben', marketplaceId: 'ml1' }] }),
      );
      expect(out.marca).toBe('Nicoben');
    });

    it('prefers the BRAND valueName over the raw value', () => {
      const out = mapper.map(
        baseProduct({ attributes: [{ code: 'BRAND', value: '123', valueName: 'Marca Bonita' }] }),
      );
      expect(out.marca).toBe('Marca Bonita');
    });

    it('is empty when no brand source exists', () => {
      const out = mapper.map(baseProduct());
      expect(out.marca).toBe('');
    });
  });

  describe('atributos', () => {
    it('lists only internal (non-marketplace) attributes as "Nome: Valor"', () => {
      const out = mapper.map(
        baseProduct({
          attributes: [
            { name: 'Quantidade', value: '60 cápsulas' },
            { name: 'BRAND', value: 'Nicoben', marketplaceId: 'ml1' }, // marketplace attr — excluded
          ],
        }),
      );
      expect(out.atributos).toBe('Quantidade: 60 cápsulas');
      expect(out.atributos_count).toBe('1');
    });
  });

  describe('codigo', () => {
    it('uses barcode (EAN) when present', () => {
      const out = mapper.map(baseProduct({ barcode: '7898767280031' }));
      expect(out.codigo).toBe('7898767280031');
    });
  });
});
