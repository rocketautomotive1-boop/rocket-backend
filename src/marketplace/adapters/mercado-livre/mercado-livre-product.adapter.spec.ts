import { MercadoLivreProductAdapter } from './mercado-livre-product.adapter';

/**
 * O auth-retry agora vive no MlHttpClient (ml-http-client.spec). Aqui só
 * verificamos que createProduct delega ao client com o ctx roteado por domínio.
 */
describe('MercadoLivreProductAdapter', () => {
  function makeAdapter(httpRequest: jest.Mock): MercadoLivreProductAdapter {
    const http = { request: httpRequest, get: jest.fn(), post: jest.fn() };
    const adapter = new (MercadoLivreProductAdapter as any)(
      { generateDescription: jest.fn().mockResolvedValue('desc') }, // descriptionService
      { registerProductAdapter: jest.fn() },                        // registry
      {},                                                           // listingAdapter
      {},                                                           // listingService
      http,                                                         // MlHttpClient
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
});
