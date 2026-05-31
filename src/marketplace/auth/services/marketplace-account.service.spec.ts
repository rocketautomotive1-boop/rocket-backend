// backend/src/marketplace/auth/services/marketplace-account.service.spec.ts
// encrypt() needs MP_CRYPTO_KEY; set a deterministic test key before any import that reads it.
process.env.MP_CRYPTO_KEY = process.env.MP_CRYPTO_KEY ?? 'test-key-deterministic-32bytes!!';

import { MarketplaceAccountService } from './marketplace-account.service';

describe('MarketplaceAccountService', () => {
  const makeRepo = () => ({
    findByDomain: jest.fn(),
    findDefault: jest.fn(),
    createAccount: jest.fn(),
  });

  describe('accountFor', () => {
    it('returns the domain account when one exists', async () => {
      const repo = makeRepo();
      repo.findByDomain.mockResolvedValue({ label: 'ML Geral' });
      const svc = new MarketplaceAccountService(repo as any);

      const acc = await svc.accountFor('mp1', 'general');
      expect(acc?.label).toBe('ML Geral');
      expect(repo.findByDomain).toHaveBeenCalledWith('mp1', 'general');
      expect(repo.findDefault).not.toHaveBeenCalled();
    });

    it('falls back to the default account when no domain account exists', async () => {
      const repo = makeRepo();
      repo.findByDomain.mockResolvedValue(null);
      repo.findDefault.mockResolvedValue({ label: 'ML Autopeças', isDefault: true });
      const svc = new MarketplaceAccountService(repo as any);

      const acc = await svc.accountFor('mp1', 'general');
      expect(acc?.label).toBe('ML Autopeças');
      expect(repo.findDefault).toHaveBeenCalledWith('mp1');
    });
  });

  describe('registerAccount', () => {
    it('encrypts credentials before persisting (no plaintext)', async () => {
      const repo = makeRepo();
      repo.createAccount.mockImplementation(async (d: any) => d);
      const svc = new MarketplaceAccountService(repo as any);

      await svc.registerAccount({
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
});
