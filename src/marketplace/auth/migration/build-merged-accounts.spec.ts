import { buildMergedAccounts, canonicalDomain } from './build-merged-accounts';

/**
 * Idempotência + correção da migração (lógica pura). Reflete o estado REAL
 * pós-exclusão de marketplace_accounts: não há legacy accounts; o que importa é
 * sintetizar a conta autopecas-default a partir do tokens[] legado.
 */
describe('buildMergedAccounts (migração de auth)', () => {
  beforeAll(() => {
    process.env.MP_CRYPTO_KEY = process.env.MP_CRYPTO_KEY || 'test-key-migration-spec';
  });

  const activeToken = { accessToken: 'AT', refreshToken: 'RT', expiresAt: new Date(), tokenType: 'Bearer', additionalData: { userId: 2417879606 }, isActive: true };

  it('canonicalDomain normaliza autoparts → autopecas', () => {
    expect(canonicalDomain('autoparts')).toBe('autopecas');
  });

  it('sintetiza autopecas-default a partir do token legado (sem legacy accounts)', () => {
    const out = buildMergedAccounts({
      tag: 'mercadolivre', currentAccounts: [], legacyAccounts: [], activeLegacyToken: activeToken, marketplaceHasClientId: true,
    });
    expect(out.synthesized).toBe(true);
    expect(out.accounts).toHaveLength(1);
    const def = out.accounts[0];
    expect(def.label).toBe('autopecas-default');
    expect(def.isDefault).toBe(true);
    expect(def.domains).toEqual(['autopecas']);
    expect(def.token.accessToken).toBe('AT');
    expect(def.credentials).toEqual({}); // marketplaces.credentials já tem clientId
  });

  it('é idempotente: rodar 2x dá o mesmo accounts[] e não duplica', () => {
    const first = buildMergedAccounts({ tag: 'mercadolivre', currentAccounts: [], legacyAccounts: [], activeLegacyToken: activeToken, marketplaceHasClientId: true });
    const second = buildMergedAccounts({ tag: 'mercadolivre', currentAccounts: first.accounts, legacyAccounts: [], activeLegacyToken: activeToken, marketplaceHasClientId: true });
    expect(second.accounts).toHaveLength(1);
    expect(second.synthesized).toBe(false);
    expect(second.accounts[0].label).toBe('autopecas-default');
  });

  it('garante no máximo 1 isDefault (reconcilia, mantém autopecas)', () => {
    const out = buildMergedAccounts({
      tag: 'shopee',
      currentAccounts: [
        { label: 'a', isDefault: true, domains: ['general'], credentials: {} },
        { label: 'b', isDefault: true, domains: ['autopecas'], credentials: {} },
      ],
      legacyAccounts: [],
    });
    const defaults = out.accounts.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].domains).toContain('autopecas');
    expect(out.reconciled).toBe(true);
  });

  it('backfill de legacy accounts casa por label sem duplicar no re-run', () => {
    const legacy = [{ label: 'general', isDefault: false, domains: ['general'], credentials: { clientId: 'enc:v1:x' }, token: { accessToken: 'G', isActive: true } }];
    const first = buildMergedAccounts({ tag: 'mercadolivre', currentAccounts: [], legacyAccounts: legacy, activeLegacyToken: activeToken, marketplaceHasClientId: true });
    const second = buildMergedAccounts({ tag: 'mercadolivre', currentAccounts: first.accounts, legacyAccounts: legacy, activeLegacyToken: activeToken, marketplaceHasClientId: true });
    expect(first.accounts.map((a) => a.label).sort()).toEqual(['autopecas-default', 'general']);
    expect(second.accounts.map((a) => a.label).sort()).toEqual(['autopecas-default', 'general']);
  });
});
