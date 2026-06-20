import { Test } from '@nestjs/testing';
import { ShopeeCategoryAdapter } from './shopee-category.adapter';
import { ShopeeHttpClient } from './shopee-http-client';

describe('ShopeeCategoryAdapter (transport via ShopeeHttpClient)', () => {
  let adapter: ShopeeCategoryAdapter;
  const http = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeCategoryAdapter,
        { provide: ShopeeHttpClient, useValue: http },
      ],
    }).compile();
    adapter = moduleRef.get(ShopeeCategoryAdapter);
  });

  it('fetches categories via the http client (no token/shopId args)', async () => {
    http.get.mockResolvedValueOnce({ response: { category_list: [{ category_id: 1 }] } });

    const out = await adapter.getCategories();

    expect(out).toEqual([{ category_id: 1 }]);
    expect(http.get).toHaveBeenCalledWith(
      '/product/get_category',
      expect.objectContaining({ context: 'getCategories' }),
      undefined,
    );
  });

  it('passes parent_id when a parentId is given', async () => {
    http.get.mockResolvedValueOnce({ response: { category_list: [] } });

    await adapter.getCategories('123');

    expect(http.get).toHaveBeenCalledWith(
      '/product/get_category',
      expect.objectContaining({ context: 'getCategories' }),
      { parent_id: 123 },
    );
  });

  it('throws on an unexpected (non-array) category_list', async () => {
    http.get.mockResolvedValueOnce({ response: { category_list: 'oops' } });
    await expect(adapter.getCategories()).rejects.toThrow('Formato de resposta inesperado');
  });
});
