import { Test } from '@nestjs/testing';
import { ShopeeOrderAdapter } from './shopee-order.adapter';
import { ShopeeHttpClient } from './shopee-http-client';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

describe('ShopeeOrderAdapter.getOrders', () => {
  let adapter: ShopeeOrderAdapter;
  const http = {
    get: jest.fn(),
    post: jest.fn(),
  };
  const registry = { registerOrderAdapter: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeOrderAdapter,
        { provide: ShopeeHttpClient, useValue: http },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
      ],
    }).compile();
    adapter = moduleRef.get(ShopeeOrderAdapter);
  });

  it('fetches the order list via ShopeeHttpClient (signing handled by the client)', async () => {
    http.get.mockResolvedValueOnce({ response: { order_list: [] } });

    const out = await adapter.getOrders({});

    expect(out).toEqual([]);
    expect(http.get).toHaveBeenCalledWith(
      '/order/get_order_list',
      expect.objectContaining({ context: 'getOrders' }),
      expect.objectContaining({ time_range_field: 'create_time' }),
    );
  });

  it('fetches order details for the returned order_sns', async () => {
    http.get
      .mockResolvedValueOnce({ response: { order_list: [{ order_sn: 'A1' }, { order_sn: 'A2' }] } })
      .mockResolvedValueOnce({ response: { order_list: [] } });

    await adapter.getOrders({});

    expect(http.get).toHaveBeenLastCalledWith(
      '/order/get_order_detail',
      expect.objectContaining({ context: 'getOrders.details' }),
      expect.objectContaining({ order_sn_list: 'A1,A2' }),
    );
  });
});
