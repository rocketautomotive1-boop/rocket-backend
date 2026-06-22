import { MercadoLivreModerationProvider, MlInfraction, MlLastModeration } from './mercadolivre-moderation.provider';

describe('MercadoLivreModerationProvider', () => {
  let provider: MercadoLivreModerationProvider;

  beforeEach(() => {
    provider = new MercadoLivreModerationProvider();
  });

  describe('classify()', () => {
    const cases: Array<[string, string]> = [
      // verified live against a real account
      ['COMPATS', 'MISSING_COMPATIBILITIES'],
      ['DOMAIN', 'WRONG_CATEGORY'],
      ['DP', 'CONTACT_DATA'],
      ['PP', 'PROHIBITED'],
      ['FOTOS', 'PHOTO_QUALITY'],
      ['DUPLIS', 'DUPLICATE'],
      ['CATALOG', 'CATALOG_REQUIRED'],
      ['PQT', 'PHOTO_QUALITY'],
      // docs-era aliases
      ['DESC', 'PRICE_CHANGE'],
      ['OPT_OBEY', 'CATALOG_REQUIRED'],
      ['CATALOG_ONLY_RESTRICTED', 'CATALOG_REQUIRED'],
      ['OPT_OUT_REPRODUCTIZAR', 'CATALOG_REQUIRED'],
      ['LINKS', 'CONTACT_DATA'],
      ['BRAND_PROTECTION', 'BRAND_PROTECTION'],
      ['CLASI', 'CLASSIFICATION'],
      ['SOMETHING_NEW', 'UNKNOWN'],
    ];

    it.each(cases)('%s → %s', (subgroup, expected) => {
      expect(provider.classify(subgroup)).toBe(expected);
    });

    it('treats missing subgroup as UNKNOWN', () => {
      expect(provider.classify('')).toBe('UNKNOWN');
    });
  });

  describe('toCanonical()', () => {
    it('builds a canonical moderation from a raw infraction', () => {
      const inf: MlInfraction = {
        id: 'INF-1',
        element_id: 'MLB123',
        filter_subgroup: 'DOMAIN',
        date_created: '2026-06-21T10:00:00.000Z',
        reason: 'Categoria incorreta',
        remedy: 'Mude a categoria',
        suggested: {
          categories: [{ id: 'MLB99', name: 'Pastilhas', path: 'a/b', domain: 'MLB-BRAKES' }],
        },
      };

      const c = provider.toCanonical(inf);

      expect(c.marketplace).toBe('mercadolivre');
      expect(c.externalId).toBe('MLB123');
      expect(c.type).toBe('WRONG_CATEGORY');
      expect(c.subgroup).toBe('DOMAIN');
      expect(c.infractionId).toBe('INF-1');
      expect(c.reason).toBe('Categoria incorreta');
      expect(c.remedy).toBe('Mude a categoria');
      expect(c.suggestedCategories).toEqual([
        { externalId: 'MLB99', name: 'Pastilhas', path: 'a/b', domain: 'MLB-BRAKES' },
      ]);
      expect(c.detectedAt).toEqual(new Date('2026-06-21T10:00:00.000Z'));
    });

    it('prefers last_moderation wordings over infraction reason/remedy', () => {
      const inf: MlInfraction = {
        element_id: 'MLB123',
        filter_subgroup: 'COMPATS',
        reason: 'fallback reason',
        remedy: 'fallback remedy',
      };
      const last: MlLastModeration = {
        wordings: [
          { type: 'REASON', value: 'rich reason' },
          { type: 'REMEDY', value: 'rich remedy' },
        ],
      };

      const c = provider.toCanonical(inf, last);

      expect(c.reason).toBe('rich reason');
      expect(c.remedy).toBe('rich remedy');
    });

    it('falls back to related_item_id when element_id is absent', () => {
      const inf: MlInfraction = { related_item_id: 'MLB777', filter_subgroup: 'PQT' };
      expect(provider.toCanonical(inf).externalId).toBe('MLB777');
    });

    it('uses now() for detectedAt when date_created is absent', () => {
      const before = Date.now();
      const c = provider.toCanonical({ element_id: 'MLB1', filter_subgroup: 'DOMAIN' });
      expect(c.detectedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
