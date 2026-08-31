import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { MercadoLivreCompatibilityAdapter } from './mercado-livre-compatibility.adapter';
import { MlHttpClient } from './ml-http-client';

describe('MercadoLivreCompatibilityAdapter — catalog matching de peça', () => {
  let adapter: MercadoLivreCompatibilityAdapter;
  let httpGet: jest.Mock;
  let httpPost: jest.Mock;
  let httpRequest: jest.Mock;

  beforeEach(async () => {
    httpGet = jest.fn();
    httpPost = jest.fn();
    httpRequest = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreCompatibilityAdapter,
        { provide: MlHttpClient, useValue: { get: httpGet, post: httpPost, request: httpRequest } },
      ],
    }).compile();

    adapter = moduleRef.get(MercadoLivreCompatibilityAdapter);
  });

  it('searchCatalogProductsByPartNumber chama /products/search com query e categoria', async () => {
    httpGet.mockResolvedValue({ results: [{ catalog_product_id: 'MLB1', name: 'X', attributes: [] }] });

    const results = await adapter.searchCatalogProductsByPartNumber('Cofap', 'GBL1252', 'MLB22709');

    expect(httpGet).toHaveBeenCalledWith(
      '/products/search',
      expect.objectContaining({ context: expect.any(String) }),
      { site_id: 'MLB', q: 'Cofap GBL1252', category: 'MLB22709' },
    );
    expect(results).toEqual([{ catalog_product_id: 'MLB1', name: 'X', attributes: [] }]);
  });

  it('searchCatalogProductsByPartNumber devolve [] quando a resposta não tem results', async () => {
    httpGet.mockResolvedValue({});

    const results = await adapter.searchCatalogProductsByPartNumber('Cofap', 'GBL1252', 'MLB22709');

    expect(results).toEqual([]);
  });

  it('searchCatalogProductsByPartNumber devolve [] quando a chamada falha', async () => {
    httpGet.mockRejectedValue(new Error('timeout'));

    const results = await adapter.searchCatalogProductsByPartNumber('Cofap', 'GBL1252', 'MLB22709');

    expect(results).toEqual([]);
  });

  it('getCatalogProduct chama /products/{id} e devolve o produto', async () => {
    httpGet.mockResolvedValue({ catalog_product_id: 'MLB37361266', name: 'Amortecedor', attributes: [] });

    const product = await adapter.getCatalogProduct('MLB37361266');

    expect(httpGet).toHaveBeenCalledWith('/products/MLB37361266', expect.objectContaining({ context: expect.any(String) }));
    expect(product?.catalog_product_id).toBe('MLB37361266');
  });

  it('getCatalogProduct devolve null quando a chamada falha', async () => {
    httpGet.mockRejectedValue(new Error('404'));

    const product = await adapter.getCatalogProduct('MLB_INEXISTENTE');

    expect(product).toBeNull();
  });
});

describe('MercadoLivreCompatibilityAdapter — sincronização de compatibilidade', () => {
  let adapter: MercadoLivreCompatibilityAdapter;
  let httpGet: jest.Mock;
  let httpPost: jest.Mock;
  let httpRequest: jest.Mock;

  beforeEach(async () => {
    httpGet = jest.fn();
    httpPost = jest.fn();
    httpRequest = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreCompatibilityAdapter,
        { provide: MlHttpClient, useValue: { get: httpGet, post: httpPost, request: httpRequest } },
      ],
    }).compile();

    adapter = moduleRef.get(MercadoLivreCompatibilityAdapter);
  });

  it('syncCompatibility posta em /items/{id}/compatibilities para item normal (não User Product)', async () => {
    httpPost.mockResolvedValue({ created_compatibilities_count: 1 });

    await adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] });

    expect(httpPost).toHaveBeenCalledWith(
      '/items/MLB123/compatibilities',
      expect.objectContaining({ context: expect.any(String) }),
      expect.objectContaining({ products: [{ id: 'MLB999' }], site_id: 'MLB', domain_id: 'MLB-CARS_AND_VANS' }),
    );
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('syncCompatibility roteia pelo accountId dono do item quando informado (não a conta ativa)', async () => {
    httpPost.mockResolvedValue({ created_compatibilities_count: 1 });

    await adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] }, 'account-dono-123');

    expect(httpPost).toHaveBeenCalledWith(
      '/items/MLB123/compatibilities',
      expect.objectContaining({ accountId: 'account-dono-123' }),
      expect.anything(),
    );
  });

  it('syncCompatibility lança erro quando ML aceita mas cria 0 compatibilidades', async () => {
    httpPost.mockResolvedValue({ created_compatibilities_count: 0 });

    await expect(
      adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('syncCompatibility retenta via /user-products/{up_id}/compatibilities quando o item já é User Product', async () => {
    const userProductError = {
      response: {
        status: 400,
        data: { error: 'bad_request', message: 'This Item MLB123 has User Product compatibilities. Use the corresponding User Product resources.', status: 400 },
      },
    };
    httpPost
      .mockRejectedValueOnce(userProductError) // POST /items/MLB123/compatibilities — rejeitado
      .mockResolvedValueOnce({ created_compatibilities_count: 1 }); // POST /user-products/{up_id}/compatibilities
    httpGet.mockResolvedValue({ id: 'MLB123', user_product_id: 'MLBU4615173703' });

    const result = await adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'], domain_id: 'MLB-CARS_AND_VANS' });

    expect(httpGet).toHaveBeenCalledWith('/items/MLB123', expect.objectContaining({ context: expect.any(String) }));
    expect(httpPost).toHaveBeenNthCalledWith(
      2,
      '/user-products/MLBU4615173703/compatibilities',
      expect.objectContaining({ context: expect.any(String) }),
      { domain_id: 'MLB-CARS_AND_VANS', products: [{ id: 'MLB999', creation_source: 'DEFAULT' }] },
    );
    expect(result).toEqual({ created_compatibilities_count: 1 });
  });

  it('syncCompatibility lança erro claro se o item sinaliza User Product mas /items não devolve user_product_id', async () => {
    const userProductError = {
      response: { status: 400, data: { message: 'This Item MLB123 has User Product compatibilities. Use the corresponding User Product resources.' } },
    };
    httpPost.mockRejectedValueOnce(userProductError);
    httpGet.mockResolvedValue({ id: 'MLB123' }); // sem user_product_id

    await expect(
      adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('syncCompatibility NÃO retenta via user-products para um erro 400 não relacionado', async () => {
    httpPost.mockRejectedValueOnce({ response: { status: 400, data: { message: 'invalid domain_id' } } });

    await expect(
      adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] }),
    ).rejects.toThrow(InternalServerErrorException);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('getCompatibilities devolve a lista de products da resposta', async () => {
    httpGet.mockResolvedValue({ products: [{ id: '111', catalog_product_id: 'MLB999' }] });

    const result = await adapter.getCompatibilities('MLB123');

    expect(httpGet).toHaveBeenCalledWith('/items/MLB123/compatibilities', expect.objectContaining({ context: expect.any(String) }));
    expect(result).toEqual([{ id: '111', catalog_product_id: 'MLB999' }]);
  });

  it('removeCompatibilityFromMarketplace resolve o id interno do ML pelo catalog_product_id e deleta', async () => {
    httpGet.mockResolvedValue({ products: [{ id: '111', catalog_product_id: 'MLB999' }] });
    httpRequest.mockResolvedValue({ data: {} });

    const result = await adapter.removeCompatibilityFromMarketplace('MLB123', 'MLB999');

    expect(httpRequest).toHaveBeenCalledWith(
      { method: 'DELETE', path: '/items/MLB123/compatibilities/111' },
      expect.objectContaining({ context: expect.any(String) }),
    );
    expect(result).toEqual({ removed: true });
  });

  it('removeCompatibilityFromMarketplace roteia GET e DELETE pelo accountId dono quando informado', async () => {
    httpGet.mockResolvedValue({ products: [{ id: '111', catalog_product_id: 'MLB999' }] });
    httpRequest.mockResolvedValue({ data: {} });

    await adapter.removeCompatibilityFromMarketplace('MLB123', 'MLB999', 'account-dono-123');

    expect(httpGet).toHaveBeenCalledWith(
      '/items/MLB123/compatibilities',
      expect.objectContaining({ accountId: 'account-dono-123' }),
    );
    expect(httpRequest).toHaveBeenCalledWith(
      { method: 'DELETE', path: '/items/MLB123/compatibilities/111' },
      expect.objectContaining({ accountId: 'account-dono-123' }),
    );
  });

  it('removeCompatibilityFromMarketplace é no-op quando o veículo já não está mais compatível no ML', async () => {
    httpGet.mockResolvedValue({ products: [] });

    const result = await adapter.removeCompatibilityFromMarketplace('MLB123', 'MLB999');

    expect(httpRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: false });
  });
});
