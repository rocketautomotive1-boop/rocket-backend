import { MlAttributeHydrationService, isValidGtin } from './ml-attribute-hydration.service';

describe('isValidGtin', () => {
  it('accepts valid EAN-13 / EAN-8 codes', () => {
    expect(isValidGtin('7891234567895')).toBe(true); // EAN-13 (check digit 5)
    expect(isValidGtin('96385074')).toBe(true);       // EAN-8
  });
  it('rejects wrong check digit', () => {
    expect(isValidGtin('7891234567890')).toBe(false);
  });
  it('rejects wrong length / non-digits / empty', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('789123456789X')).toBe(false);
    expect(isValidGtin('')).toBe(false);
    expect(isValidGtin(null)).toBe(false);
    expect(isValidGtin(undefined)).toBe(false);
  });
});

describe('MlAttributeHydrationService', () => {
  let svc: MlAttributeHydrationService;
  beforeEach(() => { svc = new MlAttributeHydrationService(); });

  describe('hydrateMlValues', () => {
    it('returns empty when product has no useful data', () => {
      expect(svc.hydrateMlValues({}, 'mp1')).toEqual({});
    });

    it('derives PART_NUMBER/OEM/MODEL from partNumber', () => {
      const v = svc.hydrateMlValues({ partNumber: 'PN1' }, 'mp1');
      expect(v.PART_NUMBER).toBe('PN1');
      expect(v.OEM).toBe('PN1');
      expect(v.MODEL).toBe('PN1');
    });

    it('falls back MODEL to barcode (EAN) for general-domain products without partNumber', () => {
      const v = svc.hydrateMlValues({ domain: 'general', barcode: '7898767280017' }, 'mp1');
      expect(v.MODEL).toBe('7898767280017');
      // EAN fallback is MODEL-only — part number / OEM stay empty for general items.
      expect(v.PART_NUMBER).toBeUndefined();
      expect(v.OEM).toBeUndefined();
    });

    it('does not use barcode for MODEL on non-general products', () => {
      const v = svc.hydrateMlValues({ domain: 'autopecas', barcode: '7898767280017' }, 'mp1');
      expect(v.MODEL).toBeUndefined();
    });

    it('prefers partNumber over barcode for MODEL even in general domain', () => {
      const v = svc.hydrateMlValues({ domain: 'general', partNumber: 'PN1', barcode: '789' }, 'mp1');
      expect(v.MODEL).toBe('PN1');
    });

    it('sets GTIN from a valid barcode for any domain', () => {
      expect(svc.hydrateMlValues({ domain: 'general', barcode: '7898767280017' }, 'mp1').GTIN).toBe('7898767280017');
      expect(svc.hydrateMlValues({ domain: 'autopecas', barcode: '7891234567895' }, 'mp1').GTIN).toBe('7891234567895');
    });

    it('does not set GTIN when the barcode is not a valid GTIN', () => {
      expect(svc.hydrateMlValues({ barcode: '12345' }, 'mp1').GTIN).toBeUndefined();
      expect(svc.hydrateMlValues({ barcode: '7891234567890' }, 'mp1').GTIN).toBeUndefined();
      expect(svc.hydrateMlValues({}, 'mp1').GTIN).toBeUndefined();
    });

    it('prefers ML-saved attributes over derived ones', () => {
      const product = {
        partNumber: 'PN1',
        attributes: [{ marketplaceId: 'mp1', code: 'PART_NUMBER', value: 'OVERRIDE' }],
      };
      expect(svc.hydrateMlValues(product, 'mp1').PART_NUMBER).toBe('OVERRIDE');
    });

    it('only picks attributes for the requested marketplace', () => {
      const product = {
        attributes: [{ marketplaceId: 'other', code: 'BRAND', value: 'Foo' }],
      };
      expect(svc.hydrateMlValues(product, 'mp1').BRAND).toBeUndefined();
    });

    it('converts dimensions to cm and weight to g', () => {
      const v = svc.hydrateMlValues({
        dimensions: { height: 5, width: 12, length: 20 },
        weight: 0.5,
      }, 'mp1');
      expect(v.SELLER_PACKAGE_HEIGHT).toBe('5 cm');
      expect(v.SELLER_PACKAGE_WIDTH).toBe('12 cm');
      expect(v.SELLER_PACKAGE_LENGTH).toBe('20 cm');
      expect(v.SELLER_PACKAGE_WEIGHT).toBe('500 g');
    });
  });

  describe('applyMlDimensionClamping', () => {
    it('clamps below minimum to minimum', () => {
      const v: Record<string, string> = { SELLER_PACKAGE_WIDTH: '5 cm' };
      svc.applyMlDimensionClamping(v);
      expect(v.SELLER_PACKAGE_WIDTH).toBe('10 cm');
    });

    it('leaves valid values intact', () => {
      const v: Record<string, string> = { SELLER_PACKAGE_HEIGHT: '7 cm' };
      svc.applyMlDimensionClamping(v);
      expect(v.SELLER_PACKAGE_HEIGHT).toBe('7 cm');
    });

    it('ignores missing keys', () => {
      const v: Record<string, string> = {};
      svc.applyMlDimensionClamping(v);
      expect(v).toEqual({});
    });
  });

  describe('computeMissingMlRequiredAttrs', () => {
    it('returns name of missing required attrs', () => {
      const schema = [
        { id: 'BRAND', name: 'Marca', tags: { required: true } },
        { id: 'COLOR', name: 'Cor', tags: { required: false } },
      ];
      expect(svc.computeMissingMlRequiredAttrs(schema, {})).toEqual(['Marca']);
    });

    it('skips required attrs with a single fixed value', () => {
      const schema = [
        { id: 'X', name: 'X', tags: { required: true, fixed: true }, values: [{ id: 'v1' }] },
      ];
      expect(svc.computeMissingMlRequiredAttrs(schema, {})).toEqual([]);
    });

    it('returns empty when all required are filled', () => {
      const schema = [{ id: 'BRAND', name: 'Marca', tags: { required: true } }];
      expect(svc.computeMissingMlRequiredAttrs(schema, { BRAND: 'X' })).toEqual([]);
    });
  });

  describe('buildMlAttributesPayload', () => {
    it('includes only attrs in the valid id set or schema', () => {
      const schema = [{ id: 'BRAND', name: 'Marca', value_type: 'string' }];
      const out = svc.buildMlAttributesPayload({ BRAND: 'Acme', UNKNOWN: 'x' }, schema);
      expect(out.map(a => a.id)).toEqual(['BRAND']);
      expect(out[0]).toMatchObject({ id: 'BRAND', name: 'Marca', value: 'Acme' });
    });

    it('attaches valueName from list options when ids match', () => {
      const schema = [{ id: 'COLOR', name: 'Cor', values: [{ id: 'red', name: 'Vermelho' }] }];
      const out = svc.buildMlAttributesPayload({ COLOR: 'red' }, schema);
      expect(out[0].valueName).toBe('Vermelho');
    });
  });

  describe('productHasSavedMlAttrsForCategory', () => {
    it('returns true when an attribute matches marketplace and externalCategory', () => {
      const product = {
        attributes: [{ marketplaceId: 'mp1', externalCategory: 'MLB123', code: 'BRAND', value: 'X' }],
      };
      expect(svc.productHasSavedMlAttrsForCategory(product, 'mp1', 'MLB123')).toBe(true);
    });

    it('returns false when nothing matches', () => {
      expect(svc.productHasSavedMlAttrsForCategory({ attributes: [] }, 'mp1', 'MLB123')).toBe(false);
    });
  });
});
