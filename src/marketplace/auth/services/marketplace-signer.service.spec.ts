import { createHmac } from 'crypto';
import { MarketplaceSignerService } from './marketplace-signer.service';

/**
 * Valida a assinatura feita NO BACKEND (segredo não sai). Reproduz a fórmula
 * canônica de cada marketplace com segredos fixos e confere o `sign`/headers.
 */
describe('MarketplaceSignerService', () => {
  // Credenciais por conta-de-domínio: 'general' tem segredo PRÓPRIO, distinto de
  // 'autopecas' (o default). É exatamente a segregação que o signer deve honrar.
  const creds: Record<string, Record<string, Record<string, string>>> = {
    shopee: {
      autopecas: { partnerId: '2013835', partnerKey: 'shpk_test_key' },
      general: { partnerId: '9999999', partnerKey: 'shpk_general_key' },
    },
    tiktokshop: {
      autopecas: { appKey: 'app_key_x', appSecret: 'app_secret_y' },
      general: { appKey: 'app_key_g', appSecret: 'app_secret_g' },
    },
    amazon: {
      autopecas: { awsAccessKey: 'AKIA_TEST', awsSecretKey: 'aws_secret_test' },
      general: { awsAccessKey: 'AKIA_GEN', awsSecretKey: 'aws_secret_gen' },
    },
  };
  const brokerMock = {
    signingCredentialForDomain: jest.fn(
      (tag: string, domain: string | undefined, key: string) =>
        Promise.resolve(creds[tag]?.[domain ?? 'autopecas']?.[key]),
    ),
  };
  const signer = new MarketplaceSignerService(brokerMock as any);
  // Atalho para o segredo default (autopecas) usado nas asserções base.
  const def = {
    shopee: creds.shopee.autopecas,
    tiktokshop: creds.tiktokshop.autopecas,
    amazon: creds.amazon.autopecas,
  };

  it('Shopee: HMAC-SHA256 sobre partnerId+fullPath+ts (sem token)', async () => {
    const path = '/product/add_item';
    const timestamp = 1700000000;
    const { params } = (await signer.sign('shopee', { path, timestamp })) as { params: any };

    const fullPath = `/api/v2${path}`;
    const expected = createHmac('sha256', def.shopee.partnerKey).update(`${def.shopee.partnerId}${fullPath}${timestamp}`).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.partner_id).toBe(2013835);
    expect(params.timestamp).toBe(timestamp);
    // segredo nunca aparece na resposta
    expect(JSON.stringify(params)).not.toContain(def.shopee.partnerKey);
  });

  it('Shopee: inclui access_token+shop_id na base quando presentes', async () => {
    const path = '/product/update_item';
    const timestamp = 1700000001;
    const { params } = (await signer.sign('shopee', { path, timestamp, accessToken: 'AT', shopId: 555 })) as { params: any };

    const fullPath = `/api/v2${path}`;
    const expected = createHmac('sha256', def.shopee.partnerKey).update(`${def.shopee.partnerId}${fullPath}${timestamp}AT555`).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.shop_id).toBe(555);
    expect(params.access_token).toBe('AT');
  });

  it('TikTok: HMAC-SHA256 wrapped com appSecret', async () => {
    const path = '/product/202309/products';
    const timestamp = 1700000002;
    const body = '{"x":1}';
    const { params } = (await signer.sign('tiktokshop', { path, timestamp, accessToken: 'AT', body })) as { params: any };

    const baseParams: Record<string, any> = { app_key: def.tiktokshop.appKey, timestamp };
    const paramString = Object.keys(baseParams).sort().map((k) => `${k}${baseParams[k]}`).join('');
    const content = `${path}${paramString}${body}`;
    const wrapped = `${def.tiktokshop.appSecret}${content}${def.tiktokshop.appSecret}`;
    const expected = createHmac('sha256', def.tiktokshop.appSecret).update(wrapped).digest('hex');
    expect(params.sign).toBe(expected);
    expect(params.access_token).toBe('AT');
    expect(JSON.stringify(params)).not.toContain(def.tiktokshop.appSecret);
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
    expect(JSON.stringify(headers)).not.toContain(def.amazon.awsSecretKey);
  });

  it('lança para marketplace sem assinatura suportada', async () => {
    await expect(signer.sign('mercadolivre', {})).rejects.toBeDefined();
  });

  // ── Regressão: domínio roteia o SEGREDO, não só o token ────────────────────
  it('Shopee: produto general usa o partnerKey da conta general (não o de autopecas)', async () => {
    const path = '/product/add_item';
    const timestamp = 1700000010;
    const { params } = (await signer.sign('shopee', { path, timestamp, domain: 'general' })) as { params: any };

    const fullPath = `/api/v2${path}`;
    const expectedGeneral = createHmac('sha256', creds.shopee.general.partnerKey).update(`${creds.shopee.general.partnerId}${fullPath}${timestamp}`).digest('hex');
    const wouldBeAutopecas = createHmac('sha256', def.shopee.partnerKey).update(`${def.shopee.partnerId}${fullPath}${timestamp}`).digest('hex');

    expect(params.sign).toBe(expectedGeneral);
    expect(params.sign).not.toBe(wouldBeAutopecas);
    expect(params.partner_id).toBe(9999999);
    expect(brokerMock.signingCredentialForDomain).toHaveBeenCalledWith('shopee', 'general', 'partnerKey');
  });

  it('lança NotFound quando o segredo do domínio não existe', async () => {
    await expect(
      signer.sign('shopee', { path: '/x', timestamp: 1, domain: 'inexistente' }),
    ).rejects.toThrow(/Credencial 'partnerId'/);
  });
});
