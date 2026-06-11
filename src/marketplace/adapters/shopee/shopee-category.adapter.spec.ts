jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { response: [] } }) } }));
import { ShopeeCategoryAdapter } from './shopee-category.adapter';

describe('ShopeeCategoryAdapter signing', () => {
  it('assina via signer.sign("shopee", ...)', async () => {
    const signer = { sign: jest.fn().mockResolvedValue({ params: { partner_id: 1, timestamp: 1, sign: 'x', access_token: 'AT', shop_id: 123 } }) };
    const sut = new ShopeeCategoryAdapter(signer as any);
    await sut.getCategories('AT', '123');
    expect(signer.sign).toHaveBeenCalledWith('shopee', expect.objectContaining({
      path: '/product/get_category', accessToken: 'AT', shopId: '123',
    }));
  });
});
