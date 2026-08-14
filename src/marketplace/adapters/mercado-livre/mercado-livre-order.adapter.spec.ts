import { Test } from '@nestjs/testing';
import { MercadoLivreOrderAdapter } from './mercado-livre-order.adapter';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MlHttpClient } from './ml-http-client';

/**
 * O auth-retry agora vive no MlHttpClient (testado em ml-http-client.spec). Aqui
 * só verificamos que o adapter delega ao client com path + contexto de conta.
 */
describe('MercadoLivreOrderAdapter', () => {
  let adapter: MercadoLivreOrderAdapter;
  const registry = { registerOrderAdapter: jest.fn() };
  const http = { get: jest.fn(), post: jest.fn(), request: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreOrderAdapter,
        { provide: MarketplaceAdapterRegistry, useValue: registry },
        { provide: MlHttpClient, useValue: http },
      ],
    }).compile();
    adapter = moduleRef.get(MercadoLivreOrderAdapter);
  });

  it('getOrders resolves seller via /users/me then searches, passing accountId ctx', async () => {
    http.get
      .mockResolvedValueOnce({ id: 123 })                         // /users/me
      .mockResolvedValueOnce({ results: [] });                    // /orders/search

    const out = await adapter.getOrders({ accountId: 'ACC_B', status: 'paid' });

    expect(out).toEqual([]);
    expect(http.get).toHaveBeenNthCalledWith(1, '/users/me', expect.objectContaining({ accountId: 'ACC_B' }));
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      '/orders/search',
      expect.objectContaining({ accountId: 'ACC_B' }),
      expect.objectContaining({ seller: 123, status: 'paid' }),
    );
  });

  it('getOrderDetails fetches the order via the client', async () => {
    http.get.mockResolvedValueOnce({ id: 9, buyer: {}, order_items: [] });
    const out = await adapter.getOrderDetails('9', 'ACC_B');
    expect(out.id).toBe('9');
    expect(http.get).toHaveBeenCalledWith('/orders/9', expect.objectContaining({ accountId: 'ACC_B' }));
  });
});
