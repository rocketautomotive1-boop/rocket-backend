// src/marketplace/auth/services/token-manager.account.spec.ts
import { TokenManagerService } from './token-manager.service';

describe('TokenManagerService — account-aware OAuth resolution', () => {
  const makeMarketplaceModel = (marketplace: any) => ({
    findById: () => ({ exec: async () => marketplace }),
  });

  const oauthMarketplace = (tokens: any[]) => ({
    _id: 'mp1',
    name: 'Mercado Livre',
    tag: 'mercado-livre',
    tokenStrategy: 'oauth2',
    tokens,
  });

  it('uses the default account token when an account exists', async () => {
    const marketplace = oauthMarketplace([{ isActive: true, accessToken: 'LEGACY' }]);
    const accountRepo = {
      findDefault: jest.fn().mockResolvedValue({
        token: { accessToken: 'ACCOUNT_TOKEN', refreshToken: 'r', isActive: true, additionalData: {} },
      }),
    };
    const svc = new TokenManagerService(makeMarketplaceModel(marketplace) as any, accountRepo as any);

    const resolved = await svc.resolveToken('mp1');
    expect(resolved.accessToken).toBe('ACCOUNT_TOKEN');
    expect(accountRepo.findDefault).toHaveBeenCalledWith('mp1');
  });

  it('falls back to legacy tokens[] when no default account exists', async () => {
    const marketplace = oauthMarketplace([{ isActive: true, accessToken: 'LEGACY' }]);
    const accountRepo = { findDefault: jest.fn().mockResolvedValue(null) };
    const svc = new TokenManagerService(makeMarketplaceModel(marketplace) as any, accountRepo as any);

    const resolved = await svc.resolveToken('mp1');
    expect(resolved.accessToken).toBe('LEGACY');
  });
});
