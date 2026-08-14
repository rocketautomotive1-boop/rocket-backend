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

  it('syncCompatibility sempre posta em /items/{id}/compatibilities, mesmo para User Product', async () => {
    httpPost.mockResolvedValue({ created_compatibilities_count: 1 });

    await adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] });

    expect(httpPost).toHaveBeenCalledWith(
      '/items/MLB123/compatibilities',
      expect.objectContaining({ context: expect.any(String) }),
      expect.objectContaining({ products: [{ id: 'MLB999' }], site_id: 'MLB', domain_id: 'MLB-CARS_AND_VANS' }),
    );
    // nunca deve consultar /items/{id} pra decidir rota — não há mais rota alternativa.
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('syncCompatibility lança erro quando ML aceita mas cria 0 compatibilidades (falso-sucesso do endpoint user-products)', async () => {
    httpPost.mockResolvedValue({ created_compatibilities_count: 0 });

    await expect(
      adapter.syncCompatibility('MLB123', { vehicle_ids: ['MLB999'] }),
    ).rejects.toThrow(InternalServerErrorException);
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

  it('removeCompatibilityFromMarketplace é no-op quando o veículo já não está mais compatível no ML', async () => {
    httpGet.mockResolvedValue({ products: [] });

    const result = await adapter.removeCompatibilityFromMarketplace('MLB123', 'MLB999');

    expect(httpRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: false });
  });
});
