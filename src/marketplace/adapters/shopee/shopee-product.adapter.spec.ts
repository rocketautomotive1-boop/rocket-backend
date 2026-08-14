import { Test } from '@nestjs/testing';
import { ShopeeProductAdapter } from './shopee-product.adapter';
import { ShopeeHttpClient } from './shopee-http-client';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ListingService } from '../../../listing/listing.service';

describe('ShopeeProductAdapter (transport via ShopeeHttpClient)', () => {
  let adapter: ShopeeProductAdapter;
  const http = { get: jest.fn(), post: jest.fn(), request: jest.fn() };
  const registry = { registerProductAdapter: jest.fn() };
  const descriptionService = { generateDescription: jest.fn().mockResolvedValue(null) };
  const listingService = { findByProduct: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeProductAdapter,
        { provide: ShopeeHttpClient, useValue: http },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
        { provide: MarketplaceDescriptionService, useValue: descriptionService },
        { provide: ListingService, useValue: listingService },
      ],
    }).compile();
    adapter = moduleRef.get(ShopeeProductAdapter);
  });

  it('updateProductPrice posts to /product/update_price via the http client (no token arg)', async () => {
    http.post.mockResolvedValueOnce({ ok: true });
    await adapter.updateProductPrice('123', 49.9);
    expect(http.post).toHaveBeenCalledWith(
      '/product/update_price',
      expect.objectContaining({ context: 'updateProductPrice' }),
      { item_id: 123, price_list: [{ original_price: 49.9 }] },
    );
  });

  it('updateProductStock posts to /product/update_stock with the V2 seller_stock shape', async () => {
    http.post.mockResolvedValueOnce({ ok: true });
    await adapter.updateProductStock('123', 7);
    expect(http.post).toHaveBeenCalledWith(
      '/product/update_stock',
      expect.objectContaining({ context: 'updateProductStock' }),
      { item_id: 123, stock_list: [{ seller_stock: [{ stock: 7 }] }] },
    );
  });

  it('updateProductTitle posts item_name/name without a shop_id in the body', async () => {
    http.post.mockResolvedValueOnce({ response: { item_id: 123 } });
    await adapter.updateProductTitle('123', 'Novo título');
    const body = http.post.mock.calls[0][2];
    expect(body).toEqual({ item_id: 123, item_name: 'Novo título', name: 'Novo título' });
  });

  it('getLogisticsChannels fetches /logistics/get_channel_list via the http client', async () => {
    http.get.mockResolvedValueOnce({ response: { logistics_channel_list: [{ logistics_channel_id: 91003 }] } });

    const out = await adapter.getLogisticsChannels();

    expect(http.get).toHaveBeenCalledWith(
      '/logistics/get_channel_list',
      expect.objectContaining({ context: 'getLogisticsChannels' }),
    );
    expect(out).toEqual({ response: { logistics_channel_list: [{ logistics_channel_id: 91003 }] } });
  });

  it('getItemList chains to getItemBaseInfo for the returned ids', async () => {
    http.get
      .mockResolvedValueOnce({ response: { item_list: [{ item_id: 10 }, { item_id: 20 }] } })
      .mockResolvedValueOnce({ response: { item_list: [{ item_id: 10 }, { item_id: 20 }] } });

    await adapter.getItemList({});

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      '/product/get_item_list',
      expect.objectContaining({ context: 'getItemList' }),
      expect.objectContaining({ item_status: 'NORMAL' }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      '/product/get_item_base_info',
      expect.objectContaining({ context: 'getItemBaseInfo' }),
      { item_id_list: [10, 20] },
    );
  });
});
