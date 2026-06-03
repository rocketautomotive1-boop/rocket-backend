import { parseUpdatePatch } from './update-general-product.schema';

describe('parseUpdatePatch', () => {
  it('accepts a partial dados patch', () => {
    const r = parseUpdatePatch({ name: 'Nescau 400g', brand: { name: 'Nestlé' }, description: 'achocolatado' });
    expect(r.name).toBe('Nescau 400g');
    expect(r.brand).toEqual({ name: 'Nestlé' });
  });

  it('folds top-level ncm into tax.ncm (unified ProductModel)', () => {
    const r = parseUpdatePatch({ ncm: '18069000', tax: { cest: '1700100', origin: '0' } });
    expect((r as any).ncm).toBeUndefined();
    expect(r.tax).toEqual({ ncm: '18069000', cest: '1700100', origin: '0' });
  });

  it('ncm without a tax object still produces tax.ncm', () => {
    const r = parseUpdatePatch({ ncm: '18069000' });
    expect(r.tax).toEqual({ ncm: '18069000' });
  });

  it('accepts price/cost numerics >= 0; quantity is accepted but not persisted', () => {
    const r = parseUpdatePatch({ price: 12.9, costPrice: 8, listPrice: 15, quantity: 10 });
    expect(r.price).toBe(12.9);
    expect((r as any).quantity).toBeUndefined();
  });

  it('accepts images array', () => {
    const r = parseUpdatePatch({ images: [{ url: 'http://i/1.jpg', main: true, order: 0 }] });
    expect(r.images).toHaveLength(1);
  });

  it('strips controlled fields (barcode, draftData, _id, slug, domain)', () => {
    const r = parseUpdatePatch({ name: 'X', barcode: '999', draftData: { a: 1 }, _id: 'x', slug: 's', domain: 'general' } as any);
    expect(r).not.toHaveProperty('barcode');
    expect(r).not.toHaveProperty('draftData');
    expect(r).not.toHaveProperty('_id');
    expect(r).not.toHaveProperty('slug');
    expect(r).not.toHaveProperty('domain');
    expect(r.name).toBe('X');
  });

  it('rejects negative price', () => {
    expect(() => parseUpdatePatch({ price: -1 })).toThrow();
  });

  it('rejects empty name (must be non-empty if present)', () => {
    expect(() => parseUpdatePatch({ name: '' })).toThrow();
  });

  it('rejects a non-string ncm', () => {
    expect(() => parseUpdatePatch({ ncm: 123 } as any)).toThrow();
  });

  it('strips perishable/regulatoryRegistration (no longer accepted)', () => {
    const r = parseUpdatePatch({ name: 'X', perishable: { isPerishable: true }, regulatoryRegistration: { agency: 'ANVISA' } } as any);
    expect(r).not.toHaveProperty('perishable');
    expect(r).not.toHaveProperty('regulatoryRegistration');
  });

  it('returns an empty object for an empty patch', () => {
    expect(parseUpdatePatch({})).toEqual({});
  });
});
