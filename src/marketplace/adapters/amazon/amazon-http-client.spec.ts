import axios from 'axios';
import { AmazonHttpClient } from './amazon-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

/**
 * AmazonHttpClient: transporte SP-API. Assina SigV4 (aws4) com as credenciais
 * AWS que vêm em token.additionalData (resolveAwsCredentials), injeta o LWA em
 * x-amz-access-token, e baka a query na path ANTES de assinar (SigV4 cobre a
 * query string). auth-retry/resolução de conta ficam na base — o adapter não vê
 * token, refresh, aws4 nem env.
 */
describe('AmazonHttpClient', () => {
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'AMZID' }) };
  const client = new AmazonHttpClient(authRetry as any, marketplaceRegistry as any);

  const awsAdditional = {
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'SECRET_TEST',
    region: 'us-east-1',
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    sellerId: 'SELLER1',
    marketplaceId: 'A2Q3Y263D00KWC',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tokenManager.resolveToken.mockResolvedValue({
      accessToken: 'LWA',
      additionalData: { ...awsAdditional },
      strategy: 'hybrid',
      fromDatabase: true,
    });
    tokenManager.forceRefresh.mockResolvedValue({
      accessToken: 'LWA2',
      additionalData: { ...awsAdditional },
      strategy: 'hybrid',
      fromDatabase: true,
    });
  });

  it('signs SigV4, bakes the query into the path, and sets x-amz-access-token', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { payload: { Orders: [] } } });

    const out = await client.get('/orders/v0/orders', { context: 'getOrders' }, {
      MarketplaceIds: 'A2Q3Y263D00KWC',
      MaxResultsPerPage: 50,
    });

    expect(out).toEqual({ payload: { Orders: [] } });
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    // query baked into the URL (so SigV4 covers it)
    expect(call.url).toContain('https://sellingpartnerapi-na.amazon.com/orders/v0/orders?');
    expect(call.url).toContain('MarketplaceIds=A2Q3Y263D00KWC');
    expect(call.url).toContain('MaxResultsPerPage=50');
    // no axios params — query is in the URL, not re-appended
    expect(call.params).toBeUndefined();
    // LWA token in the SP-API header
    expect(call.headers['x-amz-access-token']).toBe('LWA');
    // aws4 SigV4 produced an Authorization header
    expect(call.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(call.headers['X-Amz-Date']).toBeDefined();
    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });

  it('on 403 refreshes the SAME account and re-signs with the NEW LWA token', async () => {
    (axios.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({ data: { ok: 2 } });

    const out = await client.get('/orders/v0/orders', { context: 'getOrders' });

    expect(out).toEqual({ ok: 2 });
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    const retryCall = (axios.request as jest.Mock).mock.calls[1][0];
    expect(retryCall.headers['x-amz-access-token']).toBe('LWA2');
    // re-signed → fresh Authorization
    expect(retryCall.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('signs a POST body (invoice upload) and passes it as axios data', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { errors: [] } });
    const body = { InvoiceContent: 'base64', ContentMD5Value: 'md5' };

    const res = await client.request(
      { method: 'POST', path: '/fba/outbound/brazil/v0/shipments/SHIP1/invoice', body },
      { context: 'uploadInvoice' },
    );

    expect(res.data).toEqual({ errors: [] });
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.data).toEqual(body);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('routes by accountId over domain', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: {} });
    await client.get('/orders/v0/orders', { context: 'getOrders', accountId: 'ACC9', domain: 'general' });
    expect(tokenManager.resolveToken).toHaveBeenCalledWith('AMZID', { accountId: 'ACC9' });
  });

  it('omits x-amz-access-token when there is no LWA token (SigV4-only)', async () => {
    tokenManager.resolveToken.mockResolvedValueOnce({
      accessToken: null,
      additionalData: { ...awsAdditional },
      strategy: 'aws_sigv4',
      fromDatabase: false,
    });
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.get('/orders/v0/orders', { context: 'getOrders' });

    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.headers['x-amz-access-token']).toBeUndefined();
    expect(call.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });
});
