import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { ShopeeSignerService } from './shopee-signer.service';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';

describe('ShopeeSignerService', () => {
  let signer: ShopeeSignerService;
  const creds = {
    getRequired: jest.fn(async (_id: string, key: string) =>
      key === 'partnerId' ? '1001' : 'SECRETKEY',
    ),
  };

  beforeEach(async () => {
    creds.getRequired.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopeeSignerService,
        { provide: MarketplaceCredentialsService, useValue: creds },
      ],
    }).compile();
    signer = moduleRef.get(ShopeeSignerService);
  });

  const expectedSign = (base: string) =>
    createHmac('sha256', 'SECRETKEY').update(base).digest('hex');

  it('signs the no-token base string with the DB partnerKey', async () => {
    const sign = await signer.sign('/shop/auth_partner', 1700000000);
    expect(sign).toBe(expectedSign('1001/api/v2/shop/auth_partner1700000000'));
    expect(creds.getRequired).toHaveBeenCalledWith('shopee', 'partnerKey');
  });

  it('signs the token+shop base string', async () => {
    const sign = await signer.sign('/order/get_order_list', 1700000000, 'AT', 55);
    expect(sign).toBe(
      expectedSign('1001/api/v2/order/get_order_list1700000000AT55'),
    );
  });

  it('does not double-prefix a path that already starts with /api/v2', async () => {
    const sign = await signer.sign('/api/v2/shop/auth_partner', 1700000000);
    expect(sign).toBe(expectedSign('1001/api/v2/shop/auth_partner1700000000'));
  });

  it('builds full signed params with access_token and numeric shop_id', async () => {
    const params = await signer.buildSignedParams(
      '/order/get_order_list',
      1700000000,
      'AT',
      55,
      { page_size: 50 },
    );
    expect(params).toEqual({
      partner_id: 1001,
      timestamp: 1700000000,
      sign: expectedSign('1001/api/v2/order/get_order_list1700000000AT55'),
      access_token: 'AT',
      shop_id: 55,
      page_size: 50,
    });
  });

  it('omits access_token and shop_id when not provided', async () => {
    const params = await signer.buildSignedParams('/logistics/get_channel_list', 1700000000);
    expect(params).toEqual({
      partner_id: 1001,
      timestamp: 1700000000,
      sign: expectedSign('1001/api/v2/logistics/get_channel_list1700000000'),
    });
  });
});
