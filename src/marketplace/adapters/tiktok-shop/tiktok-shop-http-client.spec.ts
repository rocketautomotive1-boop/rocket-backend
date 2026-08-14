import axios from 'axios';
import { TikTokShopHttpClient } from './tiktok-shop-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');
// Mock signing utils so the spec is deterministic and doesn't need env keys.
jest.mock('./tiktok-shop-utils', () => ({
  getTikTokShopBaseUrl: () => 'https://open-api.tiktokglobalshop.com',
  buildSignedParams: jest.fn((path, ts, at, cipher, extra, body) => ({
    app_key: 'APPKEY',
    timestamp: ts,
    ...(cipher ? { shop_cipher: cipher } : {}),
    ...(extra ?? {}),
    sign: `SIG(${at}/${cipher}/${body ?? ''})`,
    ...(at ? { access_token: at } : {}),
  })),
  buildHeaders: (at?: string) => ({ 'Content-Type': 'application/json', 'x-tts-access-token': at || '' }),
}));

import { buildSignedParams } from './tiktok-shop-utils';

describe('TikTokShopHttpClient', () => {
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'TTID' }) };
  const client = new TikTokShopHttpClient(authRetry as any, marketplaceRegistry as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tokenManager.resolveToken.mockResolvedValue({
      accessToken: 'AT',
      additionalData: { shopCipher: 'CIPHER1' },
      strategy: 'oauth2',
      fromDatabase: true,
    });
    tokenManager.forceRefresh.mockResolvedValue({
      accessToken: 'AT2',
      additionalData: { shopCipher: 'CIPHER1' },
      strategy: 'oauth2',
      fromDatabase: true,
    });
  });

  it('signs a GET via buildSignedParams with shopCipher and sets x-tts-access-token', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { code: 0, data: { categories: [] } } });

    const out = await client.get('/product/202309/categories', { context: 'getCategories' }, { locale: 'pt-BR' });

    expect(out).toEqual({ code: 0, data: { categories: [] } });
    expect(buildSignedParams).toHaveBeenCalledWith(
      '/product/202309/categories',
      expect.any(Number),
      'AT',
      'CIPHER1',
      { locale: 'pt-BR' },
      undefined,
    );
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.url).toBe('https://open-api.tiktokglobalshop.com/product/202309/categories');
    expect(call.params).toMatchObject({ access_token: 'AT', shop_cipher: 'CIPHER1', locale: 'pt-BR' });
    expect(call.headers['x-tts-access-token']).toBe('AT');
  });

  it('signs a POST using the serialized body and passes the body as axios data', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { code: 0, data: { product_id: 'P1' } } });
    const body = { page_size: 20 };

    const res = await client.request(
      { method: 'POST', path: '/order/202309/orders/search', body },
      { context: 'getOrders' },
    );

    expect(res.data).toEqual({ code: 0, data: { product_id: 'P1' } });
    // signature computed over the serialized body
    expect(buildSignedParams).toHaveBeenCalledWith(
      '/order/202309/orders/search',
      expect.any(Number),
      'AT',
      'CIPHER1',
      undefined,
      JSON.stringify(body),
    );
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.data).toBe(body);
  });

  it('on 401 refreshes the SAME account and re-signs with the NEW token', async () => {
    (axios.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { code: 0 } });

    const out = await client.get('/product/202309/categories', { context: 'getCategories' });

    expect(out).toEqual({ code: 0 });
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(buildSignedParams).toHaveBeenLastCalledWith(
      '/product/202309/categories',
      expect.any(Number),
      'AT2',
      'CIPHER1',
      undefined,
      undefined,
    );
  });

  it('routes by accountId over domain', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { code: 0 } });
    await client.get('/x', { context: 'x', accountId: 'ACC9', domain: 'general' });
    expect(tokenManager.resolveToken).toHaveBeenCalledWith('TTID', { accountId: 'ACC9' });
  });
});
