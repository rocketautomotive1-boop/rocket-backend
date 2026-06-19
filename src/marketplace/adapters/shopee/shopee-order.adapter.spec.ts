import { Test } from '@nestjs/testing';
import axios from 'axios';
import { ShopeeOrderAdapter } from './shopee-order.adapter';
import { ShopeeAuthAdapter } from './shopee-auth.adapter';
import { ShopeeSignerService } from './shopee-signer.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

jest.mock('axios');

describe('ShopeeOrderAdapter.getOrders', () => {
  let adapter: ShopeeOrderAdapter;
  const auth = {
    getValidToken: jest.fn(async () => ({
      accessToken: 'AT',
      additionalData: { shopId: '55' },
    })),
  };
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeOrderAdapter,
        { provide: ShopeeAuthAdapter, useValue: auth },
        { provide: ShopeeSignerService, useValue: signer },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
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
});
