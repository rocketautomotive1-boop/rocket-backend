import { MercadoLivreProductAdapter } from './mercado-livre-product.adapter';

/**
 * O auth-retry agora vive no MlHttpClient (ml-http-client.spec). Aqui só
 * verificamos que createProduct delega ao client com o ctx roteado por domínio.
 */
describe('MercadoLivreProductAdapter', () => {
  function makeAdapter(
    httpRequest: jest.Mock,
    opts?: { compatibilities?: any[]; syncCompatibility?: jest.Mock; resolveAccountId?: jest.Mock },
  ): MercadoLivreProductAdapter {
    const http = { request: httpRequest, get: jest.fn(), post: jest.fn() };
    const compatibilityAdapter = { syncCompatibility: opts?.syncCompatibility ?? jest.fn().mockResolvedValue({}) };
    // Mock do PRODUCT_COMPATIBILITY_PORT (ver marketplace/ports/product-compatibility.port.ts)
    const productCompatibilityPort = {
      getCompatibilitiesByProduct: jest.fn().mockResolvedValue(opts?.compatibilities ?? []),
      markAsSynced: jest.fn().mockResolvedValue(undefined),
    };
    const storePort = { resolveAccountId: opts?.resolveAccountId ?? jest.fn().mockResolvedValue('account-1') };
    const adapter = new (MercadoLivreProductAdapter as any)(
      { generateDescription: jest.fn().mockResolvedValue('desc') }, // descriptionService
      { registerProductAdapter: jest.fn() },                        // registry
      {},                                                           // listingAdapter
      {},                                                           // listingService
      http,                                                         // MlHttpClient
      compatibilityAdapter,                                         // MercadoLivreCompatibilityAdapter
      productCompatibilityPort,                                     // PRODUCT_COMPATIBILITY_PORT
      storePort,                                                    // StorePort
    );
    adapter.buildMercadoLivreCreateData = jest.fn().mockReturnValue({ title: 'x' });
    return adapter;
  }

  it('createProduct posts /items via the client routed by {domain}', async () => {
    const request = jest.fn().mockResolvedValue({ status: 201, data: { id: 'MLB9' } });
    const adapter = makeAdapter(request);

    const res = await adapter.createProduct({ name: 'Item', domain: 'general' });

    expect(res.success).toBe(true);
    expect(res.externalId).toBe('MLB9');
    // POST /items com contexto de domínio (o token/refresh é do client)
    const [spec, ctx] = request.mock.calls[0];
    expect(spec).toEqual(expect.objectContaining({ method: 'POST', path: '/items' }));
    expect(ctx).toEqual(expect.objectContaining({ context: 'createProduct', domain: 'general' }));
  });

  it('pushes pre-existing compatibilities to ML right after creating the item', async () => {
    const request = jest.fn().mockResolvedValue({ status: 201, data: { id: 'MLB9' } });
    const syncCompatibility = jest.fn().mockResolvedValue({ created_compatibilities_count: 1 });
    const adapter = makeAdapter(request, {
      compatibilities: [{ _id: 'c1', mlVehicleId: 'MLB111' }, { _id: 'c2', mlVehicleId: 'MLB222' }],
      syncCompatibility,
    });

    const res = await adapter.createProduct({ _id: 'p1', name: 'Item', domain: 'general' });

    expect(res.success).toBe(true);
    expect(syncCompatibility).toHaveBeenCalledWith(
      'MLB9',
      expect.objectContaining({
        products: [{ id: 'MLB111' }, { id: 'MLB222' }],
        site_id: 'MLB',
        domain_id: 'MLB-CARS_AND_VANS',
      }),
      'account-1',
    );
  });

  it('does not call syncCompatibility when the product has no saved compatibilities', async () => {
    const request = jest.fn().mockResolvedValue({ status: 201, data: { id: 'MLB9' } });
    const syncCompatibility = jest.fn();
    const adapter = makeAdapter(request, { compatibilities: [], syncCompatibility });

    await adapter.createProduct({ _id: 'p1', name: 'Item', domain: 'general' });

    expect(syncCompatibility).not.toHaveBeenCalled();
  });
});
