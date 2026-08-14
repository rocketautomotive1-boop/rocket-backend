import { TikTokShopCategoryAdapter } from './tiktok-shop-category.adapter';

/**
 * Após a migração, o category adapter é um caller fino do TikTokShopHttpClient
 * com cache. Token/shopCipher e auth-retry (refresh real no 401) ficam no http
 * client — coberto por tiktok-shop-http-client.spec.ts.
 */
describe('TikTokShopCategoryAdapter', () => {
  function makeAdapter(httpGet: jest.Mock): TikTokShopCategoryAdapter {
    return new (TikTokShopCategoryAdapter as any)({ get: httpGet });
  }

  it('fetches categories via http.get and unwraps data.data.categories', async () => {
    const httpGet = jest.fn().mockResolvedValue({ data: { categories: [{ id: '1' }] } });
    const adapter = makeAdapter(httpGet);

    const out = await adapter.getCategories('pt-BR');

    expect(out).toEqual([{ id: '1' }]);
    expect(httpGet).toHaveBeenCalledWith(
      '/product/202309/categories',
      { context: 'getCategories' },
      { locale: 'pt-BR' },
    );
  });

  it('caches categories (second call does not hit http)', async () => {
    const httpGet = jest.fn().mockResolvedValue({ data: { categories: [{ id: '1' }] } });
    const adapter = makeAdapter(httpGet);

    await adapter.getCategories('pt-BR');
    await adapter.getCategories('pt-BR');

    expect(httpGet).toHaveBeenCalledTimes(1);
  });
});
