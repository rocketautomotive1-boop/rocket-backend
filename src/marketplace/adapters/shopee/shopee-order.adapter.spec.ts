jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { response: { order_list: [] } } }), post: jest.fn().mockResolvedValue({ data: {} }) } }));
import { ShopeeOrderAdapter } from './shopee-order.adapter';

describe('ShopeeOrderAdapter signing', () => {
  function makeSut() {
    const auth = {
      getValidToken: jest.fn().mockResolvedValue({ accessToken: 'AT', additionalData: { shopId: '123' } }),
      refreshToken: jest.fn(),
    };
    const registry = { registerOrderAdapter: jest.fn() };
    const signer = { sign: jest.fn().mockResolvedValue({ params: { partner_id: 1, timestamp: 1, sign: 'abc' } }) };
    const sut = new ShopeeOrderAdapter(auth as any, registry as any, signer as any);
    return { sut, auth, signer };
  }

  it('getOrders assina via MarketplaceSignerService.sign("shopee", ...)', async () => {
    const { sut, signer } = makeSut();
    try { await sut.getOrders({ limit: 1 }); } catch { /* axios mock may not cover full flow; we only assert signing */ }
    expect(signer.sign).toHaveBeenCalledWith('shopee', expect.objectContaining({
      path: '/order/get_order_list', accessToken: 'AT', shopId: expect.anything(),
    }));
  });
});
