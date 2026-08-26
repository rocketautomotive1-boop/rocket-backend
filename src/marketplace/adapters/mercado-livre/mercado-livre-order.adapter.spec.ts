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

  describe('uploadInvoice', () => {
    /** logistic_type que NÃO está na lista de invoice_data — cai no fluxo de pack padrão. */
    function mockPackLogistics() {
      http.get
        .mockResolvedValueOnce({ shipping: { id: 'SHIP1' } })          // GET /orders/:id
        .mockResolvedValueOnce({ logistic_type: 'cross_docking_meli' }); // GET /shipments/:id (não está na lista)
    }

    it('logistic_type de pack clássico (ex.: Flex/Turbo/ME1) — passa body como FACTORY (função), não como instância pronta de FormData — necessário para MarketplaceHttpClient regenerar o form em cada tentativa de retry (auth 401 ou rate limit 429); um FormData reusado é um stream já drenado e trava o request até o socket cair', async () => {
      mockPackLogistics();
      http.request.mockResolvedValueOnce({ data: { id: 'fd-1' } });

      await adapter.uploadInvoice('123', '<xml/>', { packId: '999' });

      expect(http.request).toHaveBeenCalledTimes(1);
      const [spec] = http.request.mock.calls[0];
      expect(spec.path).toBe('/packs/999/fiscal_documents');
      expect(typeof spec.body).toBe('function');

      // A factory precisa produzir um FormData válido a cada chamada
      const form1 = spec.body();
      const form2 = spec.body();
      expect(typeof form1.getHeaders).toBe('function');
      expect(form1).not.toBe(form2); // instâncias distintas, não a mesma reaproveitada
    });

    it('sem packId, usa o path de fallback por orderId', async () => {
      mockPackLogistics();
      http.request.mockResolvedValueOnce({ data: {} });
      await adapter.uploadInvoice('123', '<xml/>', {});
      const [spec] = http.request.mock.calls[0];
      expect(spec.path).toBe('/orders/123/fiscal_documents');
    });

    it('não consegue resolver o envio (erro de rede) — cai no fluxo de pack por padrão, mesmo comportamento de sempre', async () => {
      http.get.mockRejectedValueOnce(new Error('network error'));
      http.request.mockResolvedValueOnce({ data: {} });

      await adapter.uploadInvoice('123', '<xml/>', { packId: '999' });

      const [spec] = http.request.mock.calls[0];
      expect(spec.path).toBe('/packs/999/fiscal_documents');
    });

    describe.each([
      'fulfillment', 'cross_docking', 'xd_drop_off', 'drop_off', 'xd_same_day',
    ])('logistic_type=%s (envios que o ML bloqueia no endpoint de pack)', (logisticType) => {
      it('usa POST /shipments/:id/invoice_data com XML cru — não é o endpoint de pack, que o ML rejeita com 403 "you must use the biller of MercadoLibre" para esses tipos (docs.mercadolivre.com.br/pt_br/nf-places-crossdocking-xdsameday)', async () => {
        http.get
          .mockResolvedValueOnce({ shipping: { id: 'SHIP42' } })
          .mockResolvedValueOnce({ logistic_type: logisticType });
        http.request.mockResolvedValueOnce({ data: { status: 'approved' } });

        const xml = '<?xml version="1.0" encoding="UTF-8"?><nfeProc>...</nfeProc>';
        const result = await adapter.uploadInvoice('123', xml, { packId: '999' });

        expect(result).toEqual({ status: 'approved' });
        expect(http.request).toHaveBeenCalledTimes(1);
        const [spec] = http.request.mock.calls[0];
        expect(spec.path).toBe('/shipments/SHIP42/invoice_data');
        expect(spec.query).toEqual({ siteId: 'MLB' });
        expect(spec.body).toBe(xml); // XML cru, NÃO multipart/FormData
        expect(spec.headers).toEqual({ 'Content-Type': 'application/xml' });
      });

      it('já existe invoice_data salva para o shipment (nota anterior cancelada na SEFAZ e retificada) — usa PUT /shipment_invoice/:invoice_id em vez de tentar POST de novo, que o ML rejeita com shipment_invoice_already_saved', async () => {
        http.get
          .mockResolvedValueOnce({ shipping: { id: 'SHIP42' } })          // GET /orders/:id
          .mockResolvedValueOnce({ logistic_type: logisticType })         // GET /shipments/:id
          .mockResolvedValueOnce({ id: 'INV-777', status: 'approved' });  // GET /shipments/:id/invoice_data
        http.request.mockResolvedValueOnce({ data: { status: 'approved' } });

        const xml = '<?xml version="1.0" encoding="UTF-8"?><nfeProc>retificada</nfeProc>';
        const result = await adapter.uploadInvoice('123', xml, { packId: '999' });

        expect(result).toEqual({ status: 'approved' });
        expect(http.request).toHaveBeenCalledTimes(1);
        const [spec] = http.request.mock.calls[0];
        expect(spec.method).toBe('PUT');
        expect(spec.path).toBe('/shipment_invoice/INV-777/');
        expect(spec.query).toEqual({ siteId: 'MLB' });
        expect(spec.body).toBe(xml);
        expect(spec.headers).toEqual({ 'Content-Type': 'application/xml' });
      });
    });
  });
});
