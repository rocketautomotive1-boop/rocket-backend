import { Test } from '@nestjs/testing';
import axios from 'axios';
import { ShopeeOrderAdapter } from './shopee-order.adapter';
import { ShopeeSignerService } from './shopee-signer.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

describe('ShopeeOrderAdapter.getOrders', () => {
  let adapter: ShopeeOrderAdapter;
  const signer = {
    buildSignedParams: jest.fn(async () => ({
      partner_id: 1001,
      timestamp: 1700000000,
      sign: 'SIG',
      access_token: 'AT',
      shop_id: 55,
    })),
  };
  const registry = { registerOrderAdapter: jest.fn() };
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'SHOPID' }) };
  const tokenManager = {
    resolveToken: jest.fn(),
    forceRefresh: jest.fn(),
  };
  const authRetry = new AuthRetryService(tokenManager as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    tokenManager.resolveToken.mockResolvedValue({ accessToken: 'AT', additionalData: { shopId: '55' }, strategy: 'oauth2', fromDatabase: true });
    tokenManager.forceRefresh.mockResolvedValue({ accessToken: 'AT2', additionalData: { shopId: '55' }, strategy: 'oauth2', fromDatabase: true });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeOrderAdapter,
        { provide: ShopeeSignerService, useValue: signer },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
        { provide: MarketplaceRegistryService, useValue: marketplaceRegistry },
        { provide: AuthRetryService, useValue: authRetry },
      ],
    }).compile();
    adapter = moduleRef.get(ShopeeOrderAdapter);
    (axios.get as jest.Mock).mockResolvedValue({ data: { response: { order_list: [] } } });
  });

  it('signs the order-list request via ShopeeSignerService (no env access)', async () => {
    await adapter.getOrders({});
    expect(signer.buildSignedParams).toHaveBeenCalledWith(
      '/order/get_order_list',
      expect.any(Number),
      'AT',
      55,
      expect.objectContaining({ time_range_field: 'create_time' }),
    );
  });

  it('on 403 forces refresh and retries, preserving shopId routing', async () => {
    (axios.get as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 403 } })                 // order_list (AT) → 403
      .mockResolvedValueOnce({ data: { response: { order_list: [] } } });   // retry (AT2) ok

    const out = await adapter.getOrders({});

    expect(out).toEqual([]);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    // retry signs with the refreshed access token, same shopId
    expect(signer.buildSignedParams).toHaveBeenLastCalledWith(
      '/order/get_order_list',
      expect.any(Number),
      'AT2',
      55,
      expect.objectContaining({ time_range_field: 'create_time' }),
    );
  });
});
