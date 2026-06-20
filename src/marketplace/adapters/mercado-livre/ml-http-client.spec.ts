import axios from 'axios';
import { MlHttpClient } from './ml-http-client';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

describe('MlHttpClient', () => {
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'MLID' }) };
  const client = new MlHttpClient(authRetry as any, marketplaceRegistry as any);

  beforeEach(() => {
    jest.clearAllMocks();
    tokenManager.resolveToken.mockResolvedValue({ accessToken: 'OLD', additionalData: {}, strategy: 'oauth2', fromDatabase: true });
    tokenManager.forceRefresh.mockResolvedValue({ accessToken: 'NEW', additionalData: {}, strategy: 'oauth2', fromDatabase: true });
  });

  it('sends a Bearer request and returns data', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: { ok: 1 } });

    const out = await client.get('/orders/search', { context: 'getOrders', accountId: 'A' }, { x: 1 });

    expect(out).toEqual({ ok: 1 });
    const call = (axios.request as jest.Mock).mock.calls[0][0];
    expect(call.url).toBe('https://api.mercadolibre.com/orders/search');
    expect(call.headers.Authorization).toBe('Bearer OLD');
    expect(call.params).toEqual({ x: 1 });
    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });

  it('on 401 refreshes the SAME account and retries with the NEW token', async () => {
    (axios.request as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { ok: 2 } });

    const out = await client.get('/orders/search', { context: 'getOrders', accountId: 'A' });

    expect(out).toEqual({ ok: 2 });
    expect(tokenManager.forceRefresh).toHaveBeenCalledWith('MLID', { accountId: 'A' });
    // re-signed with the refreshed token
    const retryCall = (axios.request as jest.Mock).mock.calls[1][0];
    expect(retryCall.headers.Authorization).toBe('Bearer NEW');
  });

  it('routes by domain when no accountId', async () => {
    (axios.request as jest.Mock).mockResolvedValueOnce({ data: {} });
    await client.get('/items/X', { context: 'getItem', domain: 'general' });
    expect(tokenManager.resolveToken).toHaveBeenCalledWith('MLID', { domain: 'general' });
  });
});
