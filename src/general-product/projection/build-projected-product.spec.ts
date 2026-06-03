import { buildProjectedProductFields } from './build-projected-product';

const fullGeneral = {
  barcode: '7890000000001',
  name: 'Vitamina C 1g',
  brand: { name: 'ACME' }, // deriveCompletion.dados requires brand.name
  description: 'Suplemento',
  price: '49.9',
  ncm: '21069030',
  tax: { cest: '1700100', origin: '0' },
  images: [{ url: 'http://i/1.jpg', main: true, order: 0, status: 'approved' }],
  draftData: { attributes: [{ id: 'BRAND', name: 'Marca', value: 'ACME' }] },
};

describe('buildProjectedProductFields', () => {
  it('sets partNumber GEN-<barcode>, name, domain general, active', () => {
    const f = buildProjectedProductFields(fullGeneral, 'MLB1234');
    expect(f.partNumber).toBe('GEN-7890000000001');
    expect(f.name).toBe('Vitamina C 1g');
    expect(f.domain).toBe('general');
    expect(f.active).toBe(true);
  });

  it('maps images through unchanged', () => {
    const f = buildProjectedProductFields(fullGeneral, 'MLB1234');
    expect(f.images).toEqual([{ url: 'http://i/1.jpg', main: true, order: 0, status: 'approved' }]);
  });

  it('maps tax from ncm + tax', () => {
    const f = buildProjectedProductFields(fullGeneral, 'MLB1234');
    expect(f.tax).toEqual({ ncm: '21069030', cest: '1700100', origin: '0' });
  });

  it('injects a category_id attribute from mlCategoryId, after draft attrs', () => {
    const f = buildProjectedProductFields(fullGeneral, 'MLB1234');
    expect(f.attributes).toEqual([
      { id: 'BRAND', name: 'Marca', value: 'ACME' },
      { id: 'category_id', name: 'category_id', value: 'MLB1234' },
    ]);
  });

  it('omits the category_id attribute when mlCategoryId is absent', () => {
    const f = buildProjectedProductFields(fullGeneral, undefined);
    expect(f.attributes).toEqual([{ id: 'BRAND', name: 'Marca', value: 'ACME' }]);
  });

  it('readyToPublish true only when complete AND mlCategoryId present', () => {
    expect(buildProjectedProductFields(fullGeneral, 'MLB1234').readyToPublish).toBe(true);
    expect(buildProjectedProductFields(fullGeneral, undefined).readyToPublish).toBe(false);
  });

  it('readyToPublish false when a completion field is missing (no images)', () => {
    const noImg = { ...fullGeneral, images: [] };
    expect(buildProjectedProductFields(noImg, 'MLB1234').readyToPublish).toBe(false);
  });

  it('price is a number', () => {
    expect(buildProjectedProductFields(fullGeneral, 'MLB1234').price).toBe(49.9);
  });

  it('tolerates missing draftData.attributes', () => {
    const g = { ...fullGeneral, draftData: {} };
    expect(buildProjectedProductFields(g, undefined).attributes).toEqual([]);
  });
});
