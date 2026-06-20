import axios from 'axios';
import { TikTokShopCategoryAdapter } from './tiktok-shop-category.adapter';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');
jest.mock('./tiktok-shop-utils', () => ({
  getTikTokShopBaseUrl: () => 'https://open-api.tiktokglobalshop.com',
  buildSignedParams: (_p: string, _t: number, _tok: string, _c: any, extra: any) => ({ ...extra, sign: 'SIG' }),
  buildHeaders: (tok: string) => ({ 'x-tts-access-token': tok }),
}));

describe('TikTokShopCategoryAdapter.getCategories auth-retry', () => {
  const tokenManager = {
    resolveToken: jest.fn().mockResolvedValue({ accessToken: 'OLD', additionalData: { shopCipher: 'CIPH' }, strategy: 'oauth2', fromDatabase: true }),
    forceRefresh: jest.fn().mockResolvedValue({ accessToken: 'NEW', additionalData: { shopCipher: 'CIPH' }, strategy: 'oauth2', fromDatabase: true }),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'TTID' }) };
  const authAdapter = { getValidToken: jest.fn() };

  function makeAdapter(): TikTokShopCategoryAdapter {
    return new (TikTokShopCategoryAdapter as any)(authAdapter, marketplaceRegistry, authRetry);
  }

  beforeEach(() => jest.clearAllMocks());

  it('on 401 forces a REAL refresh (not getValidToken) and retries', async () => {
    (axios.get as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { data: { categories: [{ id: '1' }] } } });

    const out = await makeAdapter().getCategories('OLD', 'CIPH', 'pt-BR');

    expect(out).toEqual([{ id: '1' }]);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    // the legacy bug: it used to call getValidToken — must NOT happen now
    expect(authAdapter.getValidToken).not.toHaveBeenCalled();
  });
});
