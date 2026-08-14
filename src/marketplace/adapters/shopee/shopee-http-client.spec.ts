import axios from 'axios';
import { ShopeeHttpClient } from './shopee-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

describe('ShopeeHttpClient', () => {
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'SHOPID' }) };
  const signer = {
    buildSignedParams: jest.fn(),
  };
  const client = new ShopeeHttpClient(
    authRetry as any,
    marketplaceRegistry as any,
    signer as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tokenManager.resolveToken.mockResolvedValue({
      accessToken: 'AT',
      additionalData: { shopId: '55' },
      strategy: 'oauth2',
      fromDatabase: true,
    });
    tokenManager.forceRefresh.mockResolvedValue({
      accessToken: 'AT2',
      additionalData: { shopId: '55' },
      strategy: 'oauth2',
      fromDatabase: true,
    });
    signer.buildSignedParams.mockImplementation(async (_p, ts, at, shopId, extra) => ({
      partner_id: 1001,
      timestamp: ts,
      sign: `SIG(${at}/${shopId})`,
      access_token: at,
      shop_id: shopId,
      ...(extra ?? {}),
    }));
  });

  it('signs the request via ShopeeSignerService and puts the signed params in axios params', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { ok: 1 } });

    const out = await client.get('/order/get_order_list', { context: 'getOrders' }, { time_from: 1 });

    expect(out).toEqual({ ok: 1 });
    expect(signer.buildSignedParams).toHaveBeenCalledWith(
      '/order/get_order_list',
      expect.any(Number),
      'AT',
      '55',
      { time_from: 1 },
    );
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.url).toBe('https://partner.shopeemobile.com/api/v2/order/get_order_list');
    expect(call.params).toMatchObject({ sign: 'SIG(AT/55)', access_token: 'AT', shop_id: '55', time_from: 1 });
    // Bearer header from buildHeaders
    expect(call.headers.Authorization).toBe('Bearer AT');
    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });

  it('on 403 refreshes the SAME account and re-signs with the NEW token, preserving shopId', async () => {
    (axios.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({ data: { ok: 2 } });

    const out = await client.get('/order/get_order_list', { context: 'getOrders' });

    expect(out).toEqual({ ok: 2 });
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    // retry re-signed with refreshed access token, same shopId
    expect(signer.buildSignedParams).toHaveBeenLastCalledWith(
      '/order/get_order_list',
      expect.any(Number),
      'AT2',
      '55',
      undefined,
    );
    const retryCall = (axios.request as jest.Mock).mock.calls[1][0];
    expect(retryCall.params.access_token).toBe('AT2');
  });

  it('passes through a multipart body + headers (image upload)', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { response: { image_id: 'IMG' } } });
    const form = { _form: true };

    const res = await client.request(
      {
        method: 'POST',
        path: '/media_space/upload_image',
        body: form,
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        axiosConfig: { maxBodyLength: Infinity },
      },
      { context: 'uploadImage' },
    );

    expect(res.data).toEqual({ response: { image_id: 'IMG' } });
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.data).toBe(form);
    expect(call.headers['content-type']).toBe('multipart/form-data; boundary=x');
    expect(call.maxBodyLength).toBe(Infinity);
  });

  it('routes by domain when no accountId', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: {} });
    await client.get('/product/get_item_list', { context: 'getItemList', domain: 'general' });
    expect(tokenManager.resolveToken).toHaveBeenCalledWith('SHOPID', { domain: 'general' });
  });
});
