import { MercadoLivreProductAdapter } from './mercado-livre-product.adapter';
import { MARKETPLACE_EVENTS } from '../../events/marketplace.events';

/**
 * O auth-retry agora vive no MlHttpClient (ml-http-client.spec). Aqui verificamos que
 * createProduct delega ao client com o ctx roteado por domínio, e que create/update
 * emitem MARKETPLACE_EVENTS.ITEM_PUBLISHED — o adapter NÃO fala com compatibilidades
 * diretamente (isso é responsabilidade de ProductService, ver product.service.ts
 * handleMarketplaceItemPublished); ele só publica o fato de que o item existe no ML.
 */
describe('MercadoLivreProductAdapter', () => {
  function makeAdapter(httpRequest: jest.Mock, emit?: jest.Mock): MercadoLivreProductAdapter {
    const http = { request: httpRequest, get: jest.fn(), post: jest.fn() };
    const eventEmitter = { emit: emit ?? jest.fn() };
    const adapter = new (MercadoLivreProductAdapter as any)(
      { generateDescription: jest.fn().mockResolvedValue('desc') }, // descriptionService
      { registerProductAdapter: jest.fn() },                        // registry
      {},                                                           // listingAdapter
      {},                                                           // listingService
      http,                                                         // MlHttpClient
      eventEmitter,                                                 // EventEmitter2
    );
    adapter.buildMercadoLivreCreateData = jest.fn().mockReturnValue({ title: 'x' });
    adapter.buildMercadoLivreUpdateData = jest.fn().mockReturnValue({ title: 'x' });
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

  it('emits MARKETPLACE_EVENTS.ITEM_PUBLISHED after creating the item', async () => {
    const request = jest.fn().mockResolvedValue({ status: 201, data: { id: 'MLB9' } });
    const emit = jest.fn();
    const adapter = makeAdapter(request, emit);

    await adapter.createProduct({ _id: 'p1', name: 'Item', domain: 'general' });

    expect(emit).toHaveBeenCalledWith(
      MARKETPLACE_EVENTS.ITEM_PUBLISHED,
      expect.objectContaining({ productId: 'p1', externalId: 'MLB9', marketplaceName: 'Mercado Livre' }),
    );
  });

  it('emits MARKETPLACE_EVENTS.ITEM_PUBLISHED after updating an existing item', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: { id: 'MLB9' } });
    const emit = jest.fn();
    const adapter = makeAdapter(request, emit);
    (adapter as any).getItem = jest.fn().mockResolvedValue({});
    (adapter as any).canUpdateItem = jest.fn().mockReturnValue({ canUpdate: true, restrictions: [] });
    (adapter as any).filterUpdatableFields = jest.fn().mockReturnValue({ title: 'x' });

    await adapter.updateProduct('MLB9', { _id: 'p1', name: 'Item', domain: 'general', storeId: 's1' });

    expect(emit).toHaveBeenCalledWith(
      MARKETPLACE_EVENTS.ITEM_PUBLISHED,
      expect.objectContaining({ productId: 'p1', externalId: 'MLB9', marketplaceName: 'Mercado Livre' }),
    );
  });
});
