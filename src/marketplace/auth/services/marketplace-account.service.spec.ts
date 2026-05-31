// backend/src/marketplace/auth/services/marketplace-account.service.spec.ts
// encrypt() needs MP_CRYPTO_KEY; set a deterministic test key before any import that reads it.
process.env.MP_CRYPTO_KEY = process.env.MP_CRYPTO_KEY ?? 'test-key-deterministic-32bytes!!';

import { MarketplaceAccountService } from './marketplace-account.service';
import { encrypt } from './credentials-crypto.helper';

describe('MarketplaceAccountService', () => {
  const makeRepo = () => ({
    findByDomain: jest.fn(),
    findDefault: jest.fn(),
    createAccount: jest.fn(),
    findById: jest.fn(),
    updateToken: jest.fn().mockResolvedValue(undefined),
  });
  const makeAdapter = () => ({
    refreshTokenForAccount: jest.fn(),
  });
  const svc = (repo: any, adapter: any = makeAdapter()) =>
    new MarketplaceAccountService(repo as any, adapter as any);

  describe('accountFor', () => {
    it('returns the domain account when one exists', async () => {
      const repo = makeRepo();
      repo.findByDomain.mockResolvedValue({ label: 'ML Geral' });

      const acc = await svc(repo).accountFor('mp1', 'general');
      expect(acc?.label).toBe('ML Geral');
      expect(repo.findByDomain).toHaveBeenCalledWith('mp1', 'general');
      expect(repo.findDefault).not.toHaveBeenCalled();
    });

    it('falls back to the default account when no domain account exists', async () => {
      const repo = makeRepo();
      repo.findByDomain.mockResolvedValue(null);
      repo.findDefault.mockResolvedValue({ label: 'ML Autopeças', isDefault: true });

      const acc = await svc(repo).accountFor('mp1', 'general');
      expect(acc?.label).toBe('ML Autopeças');
      expect(repo.findDefault).toHaveBeenCalledWith('mp1');
    });
  });

  describe('registerAccount', () => {
    it('encrypts credentials before persisting (no plaintext)', async () => {
      const repo = makeRepo();
      repo.createAccount.mockImplementation(async (d: any) => d);

      await svc(repo).registerAccount({
        marketplaceId: 'mp1',
        label: 'ML Geral',
        domains: ['general'],
        credentials: { clientId: 'PLAINTEXT_ID', clientSecret: 'PLAINTEXT_SECRET' },
      });

      const persisted = repo.createAccount.mock.calls[0][0];
      expect(persisted.credentials.clientId).not.toBe('PLAINTEXT_ID');
      expect(persisted.credentials.clientId.startsWith('enc:v1:')).toBe(true);
      expect(persisted.credentials.clientSecret.startsWith('enc:v1:')).toBe(true);
    });
  });

  describe('saveAccountToken', () => {
    it('persists the token on the account', async () => {
      const repo = makeRepo();
      await svc(repo).saveAccountToken('acc1', { accessToken: 'AT', refreshToken: 'RT', isActive: true });
      expect(repo.updateToken).toHaveBeenCalledWith('acc1', expect.objectContaining({ accessToken: 'AT', isActive: true }));
    });
  });

  describe('refreshAccountToken', () => {
    it('decrypts account credentials, calls the adapter, and saves the new token', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue({
        _id: 'acc1',
        credentials: { clientId: encrypt('CID'), clientSecret: encrypt('CSECRET') },
        token: { refreshToken: 'OLD_RT', additionalData: {} },
      });
      const adapter = makeAdapter();
      adapter.refreshTokenForAccount.mockResolvedValue({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT', isActive: true });

      await svc(repo, adapter).refreshAccountToken('acc1');

      // adapter received DECRYPTED credentials
      expect(adapter.refreshTokenForAccount).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: 'OLD_RT' }),
        'CID',
        'CSECRET',
      );
      expect(repo.updateToken).toHaveBeenCalledWith('acc1', expect.objectContaining({ accessToken: 'NEW_AT' }));
    });

    it('throws when the account has no token to refresh', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue({ _id: 'acc1', credentials: {}, token: null });
      await expect(svc(repo).refreshAccountToken('acc1')).rejects.toBeTruthy();
    });
  });
});
