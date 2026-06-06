import { createHmac } from 'crypto';
import { MarketplaceSignerService } from './marketplace-signer.service';

/**
 * Valida a assinatura feita NO BACKEND (segredo não sai). Reproduz a fórmula
 * canônica de cada marketplace com segredos fixos e confere o `sign`/headers.
 */
describe('MarketplaceSignerService', () => {
  const creds: Record<string, Record<string, string>> = {
    shopee: { partnerId: '2013835', partnerKey: 'shpk_test_key' },
    tiktokshop: { appKey: 'app_key_x', appSecret: 'app_secret_y' },
    amazon: { awsAccessKey: 'AKIA_TEST', awsSecretKey: 'aws_secret_test' },
  };
  const credentialsMock = {
    getRequired: jest.fn((tag: string, key: string) => {
      const v = creds[tag]?.[key];
      if (!v) throw new Error(`missing ${tag}/${key}`);
      return Promise.resolve(v);
    }),
  };
  const signer = new MarketplaceSignerService(credentialsMock as any);

  it('Shopee: HMAC-SHA256 sobre partnerId+fullPath+ts (sem token)', async () => {
    const path = '/product/add_item';
    const timestamp = 1700000000;
    const { params } = (await signer.sign('shopee', { path, timestamp })) as { params: any };

    const fullPath = `/api/v2${path}`;
    const expected = createHmac('sha256', creds.shopee.partnerKey).update(`${creds.shopee.partnerId}${fullPath}${timestamp}`).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.partner_id).toBe(2013835);
    expect(params.timestamp).toBe(timestamp);
    // segredo nunca aparece na resposta
    expect(JSON.stringify(params)).not.toContain(creds.shopee.partnerKey);
  });

  it('Shopee: inclui access_token+shop_id na base quando presentes', async () => {
    const path = '/product/update_item';
    const timestamp = 1700000001;
    const { params } = (await signer.sign('shopee', { path, timestamp, accessToken: 'AT', shopId: 555 })) as { params: any };

    const fullPath = `/api/v2${path}`;
    const expected = createHmac('sha256', creds.shopee.partnerKey).update(`${creds.shopee.partnerId}${fullPath}${timestamp}AT555`).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.shop_id).toBe(555);
    expect(params.access_token).toBe('AT');
  });

  it('TikTok: HMAC-SHA256 wrapped com appSecret', async () => {
    const path = '/product/202309/products';
    const timestamp = 1700000002;
    const body = '{"x":1}';
    const { params } = (await signer.sign('tiktokshop', { path, timestamp, accessToken: 'AT', body })) as { params: any };

    const baseParams: Record<string, any> = { app_key: creds.tiktokshop.appKey, timestamp };
    const paramString = Object.keys(baseParams).sort().map((k) => `${k}${baseParams[k]}`).join('');
    const content = `${path}${paramString}${body}`;
    const wrapped = `${creds.tiktokshop.appSecret}${content}${creds.tiktokshop.appSecret}`;
    const expected = createHmac('sha256', creds.tiktokshop.appSecret).update(wrapped).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.access_token).toBe('AT');
    expect(JSON.stringify(params)).not.toContain(creds.tiktokshop.appSecret);
  });

  it('Amazon: devolve headers SigV4 (Authorization + x-amz-*) sem expor o secret', async () => {
    const { headers } = (await signer.sign('amazon', {
      method: 'PUT',
      host: 'sellingpartnerapi-na.amazon.com',
      path: '/listings/2021-08-01/items/SELLER/SKU?marketplaceIds=A2Q3Y263D00KWC',
      accessToken: 'AMZ_AT',
      body: '{"a":1}',
      region: 'us-east-1',
    })) as { headers: Record<string, string> };

    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256/);
    expect(headers['X-Amz-Date'] || headers['x-amz-date']).toBeDefined();
    expect(headers['x-amz-access-token']).toBe('AMZ_AT');
    expect(JSON.stringify(headers)).not.toContain(creds.amazon.awsSecretKey);
  });

  it('lança para marketplace sem assinatura suportada', async () => {
    await expect(signer.sign('mercadolivre', {})).rejects.toBeDefined();
  });
});
