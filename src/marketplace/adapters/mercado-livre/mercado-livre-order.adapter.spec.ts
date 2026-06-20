import { Test } from '@nestjs/testing';
import axios from 'axios';
import { MercadoLivreOrderAdapter } from './mercado-livre-order.adapter';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

describe('MercadoLivreOrderAdapter retry', () => {
  let adapter: MercadoLivreOrderAdapter;
  const registry = { registerOrderAdapter: jest.fn() };
  const marketplaceRegistry = { findByName: jest.fn() };
  // Real-ish AuthRetryService over a mocked TokenManager so we assert the
  // canonical "refresh the SAME account that failed" invariant end-to-end.
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    marketplaceRegistry.findByName.mockResolvedValue({ _id: 'MLID' });
    tokenManager.resolveToken.mockResolvedValue({ accessToken: 'OLD', additionalData: {}, strategy: 'oauth2', fromDatabase: true });
    tokenManager.forceRefresh.mockResolvedValue({ accessToken: 'NEW', additionalData: {}, strategy: 'oauth2', fromDatabase: true });

    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreOrderAdapter,
        { provide: MarketplaceAdapterRegistry, useValue: registry },
        { provide: MarketplaceRegistryService, useValue: marketplaceRegistry },
        { provide: AuthRetryService, useValue: authRetry },
      ],
    }).compile();
    adapter = moduleRef.get(MercadoLivreOrderAdapter);
  });

  it('forces refresh of the SAME accountId that failed with 401, then retries', async () => {
    // /users/me, then /orders/search 401, then refreshed retry: me + search
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 123 } })                 // me (OLD)
      .mockRejectedValueOnce({ response: { status: 401 } })          // search (OLD) → 401
      .mockResolvedValueOnce({ data: { id: 123 } })                 // me (NEW)
      .mockResolvedValueOnce({ data: { results: [] } });            // search (NEW)

    const result = await adapter.getOrders({ accountId: 'ACC_B' });

    expect(result).toEqual([]);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(tokenManager.forceRefresh).toHaveBeenCalledWith('MLID', { accountId: 'ACC_B' });
  });

  it('does not refresh when the call succeeds', async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 1 } })
      .mockResolvedValueOnce({ data: { results: [] } });

    await adapter.getOrders({ accountId: 'ACC_B' });

    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });
});
