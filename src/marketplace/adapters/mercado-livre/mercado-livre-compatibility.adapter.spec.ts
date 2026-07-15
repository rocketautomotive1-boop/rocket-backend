import { Test } from '@nestjs/testing';
import { MercadoLivreCompatibilityAdapter } from './mercado-livre-compatibility.adapter';
import { MlHttpClient } from './ml-http-client';

describe('MercadoLivreCompatibilityAdapter — catalog matching de peça', () => {
  let adapter: MercadoLivreCompatibilityAdapter;
  let httpGet: jest.Mock;

  beforeEach(async () => {
    httpGet = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreCompatibilityAdapter,
        { provide: MlHttpClient, useValue: { get: httpGet, post: jest.fn(), request: jest.fn() } },
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
