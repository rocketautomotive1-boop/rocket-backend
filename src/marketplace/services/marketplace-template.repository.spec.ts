import { MarketplaceTemplateRepository } from './marketplace-template.repository';

describe('MarketplaceTemplateRepository.findDefault (domain selection)', () => {
  const makeRepo = (templates: any[], activeAccountId: string | null = null) => {
    const marketplace = { _id: 'mp1', name: 'Mercado Livre', templates, activeAccountId };
    // findMarketplaceByName chains findOne(...) — first call resolves the marketplace.
    const model: any = { findOne: jest.fn().mockResolvedValue(marketplace) };
    const configCache: any = { invalidate: jest.fn() };
    return new MarketplaceTemplateRepository(model, configCache);
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

  // ── Account-scoped override (domain + accountId) ──────────────────────────
  const generalAcc = { name: 'Geral Conta X', isDefault: true, isActive: true, domain: 'general', accountId: 'accX' };

  it('prefers the (domain + active account) template over the plain domain template', async () => {
    const repo = makeRepo([general, generalAcc], 'accX');
    const t = await repo.findDefault('Mercado Livre', 'general');
    expect(t?.name).toBe('Geral Conta X');
  });

  it('falls back to the plain domain template when the active account does not match', async () => {
    const repo = makeRepo([general, generalAcc], 'accY');
    const t = await repo.findDefault('Mercado Livre', 'general');
    expect(t?.name).toBe('Geral'); // accountId override only fires for accX
  });

  it('falls back to the plain domain template when there is no active account', async () => {
    const repo = makeRepo([general, generalAcc], null);
    const t = await repo.findDefault('Mercado Livre', 'general');
    expect(t?.name).toBe('Geral'); // legacy behavior: no active account → ignore account override
  });

  it('uses the account-scoped classic template for autopecas when the active account matches', async () => {
    const classicAcc = { name: 'Autopeças Conta X', isDefault: true, isActive: true, accountId: 'accX' };
    const repo = makeRepo([classic, classicAcc], 'accX');
    expect((await repo.findDefault('Mercado Livre', 'autopecas'))?.name).toBe('Autopeças Conta X');
  });

  it('account override does not leak across domains', async () => {
    // generalAcc is account-scoped but domain=general; an autopecas product must not pick it.
    const repo = makeRepo([classic, generalAcc], 'accX');
    expect((await repo.findDefault('Mercado Livre', 'autopecas'))?.name).toBe('Autopeças');
  });
});
