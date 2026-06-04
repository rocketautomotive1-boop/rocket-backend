import { MarketplaceTemplateRepository } from './marketplace-template.repository';

describe('MarketplaceTemplateRepository.findDefault (domain selection)', () => {
  const makeRepo = (templates: any[]) => {
    const marketplace = { _id: 'mp1', name: 'Mercado Livre', templates };
    // findMarketplaceByName chains findOne(...) — first call resolves the marketplace.
    const model: any = { findOne: jest.fn().mockResolvedValue(marketplace) };
    return new MarketplaceTemplateRepository(model);
  };

  const classic = { name: 'Autopeças', isDefault: true, isActive: true };
  const general = { name: 'Geral', isDefault: true, isActive: true, domain: 'general' };

  it('returns the domain template when domain matches', async () => {
    const repo = makeRepo([classic, general]);
    const t = await repo.findDefault('Mercado Livre', 'general');
    expect(t?.name).toBe('Geral');
  });

  it('falls back to the classic default when the domain has no template', async () => {
    const repo = makeRepo([classic, general]);
    const t = await repo.findDefault('Mercado Livre', 'beleza');
    expect(t?.name).toBe('Autopeças');
  });

  it('uses the classic default for autopecas / no domain', async () => {
    const repo = makeRepo([classic, general]);
    expect((await repo.findDefault('Mercado Livre', 'autopecas'))?.name).toBe('Autopeças');
    expect((await repo.findDefault('Mercado Livre'))?.name).toBe('Autopeças');
  });

  it('ignores inactive templates', async () => {
    const repo = makeRepo([{ ...general, isActive: false }, classic]);
    const t = await repo.findDefault('Mercado Livre', 'general');
    expect(t?.name).toBe('Autopeças'); // general is inactive → classic fallback
  });

  it('returns null when there is no active default', async () => {
    const repo = makeRepo([{ name: 'X', isDefault: false, isActive: true }]);
    expect(await repo.findDefault('Mercado Livre', 'general')).toBeNull();
  });
});
