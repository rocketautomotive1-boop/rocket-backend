import { MarketplaceOrderGatewayProvider } from './marketplace-order-gateway.provider';

/**
 * Contrato de listOrdersSince (delta server-side):
 *  - NUNCA pede ao adapter uma página maior que o teto do marketplace (ML rejeita limit>51).
 *  - Delega o filtro de data ao MARKETPLACE (passa `since: cursor`) — não baixa o histórico
 *    para filtrar no cliente. Com 1M de pedidos, lê só o delta (eficiência O(delta)).
 *  - Pagina (date_asc a partir do cursor) só enquanto o servidor devolver páginas cheias.
 */
describe('MarketplaceOrderGatewayProvider.listOrdersSince', () => {
  const MKT = '650000000000000000000099';
  const ML = 'Mercado Livre';

  function build(getOrders: jest.Mock) {
    const adapter = { getOrders };
    const registry = { findOne: jest.fn().mockResolvedValue({ _id: MKT, name: ML }) };
    const adapters = {
      hasOrderAdapter: jest.fn().mockReturnValue(true),
      getOrderAdapter: jest.fn().mockReturnValue(adapter),
    };
    const provider = new MarketplaceOrderGatewayProvider(registry as any, adapters as any);
    return { provider, getOrders };
  }

  /** Gera N pedidos com date_last_updated CRESCENTE (date_asc), simulando o filtro do servidor. */
  function ordersAsc(n: number, startIso: string) {
    const start = new Date(startIso).getTime();
    const day = 24 * 60 * 60 * 1000;
    return Array.from({ length: n }, (_, i) => ({
      id: `O${i}`,
      status: 'paid',
      date_last_updated: new Date(start + i * day).toISOString(),
    }));
  }

  it('nunca pede ao adapter um limit acima do teto do ML (<=50)', async () => {
    const getOrders = jest.fn().mockResolvedValue([]);
    const { provider } = build(getOrders);

    await provider.listOrdersSince(MKT, new Date('2026-06-01T00:00:00Z'));

    expect(getOrders).toHaveBeenCalled();
    for (const call of getOrders.mock.calls) {
      expect(call[0].limit).toBeLessThanOrEqual(50);
    }
  });

  it('delega o filtro de data ao marketplace: passa since=cursor ao adapter', async () => {
    const getOrders = jest.fn().mockResolvedValue([]);
    const { provider } = build(getOrders);
    const cursor = new Date('2026-06-18T00:00:00.000Z');

    await provider.listOrdersSince(MKT, cursor);

    expect(getOrders).toHaveBeenCalledWith(expect.objectContaining({ since: cursor }));
  });

  it('NÃO baixa o histórico: confia no delta do servidor (1M de pedidos → lê só o delta)', async () => {
    // O servidor (filtro date_last_updated.from) já devolve só o delta. Aqui ele devolve 24.
    const delta = ordersAsc(24, '2026-06-18T01:00:00Z');
    const getOrders = jest.fn(async ({ offset, limit }: any) => delta.slice(offset, offset + limit));
    const { provider } = build(getOrders);

    const refs = await provider.listOrdersSince(MKT, new Date('2026-06-18T00:00:00Z'));

    expect(refs).toHaveLength(24);
    expect(getOrders.mock.calls.length).toBe(1); // coube em 1 página → 1 chamada só
    // ordenado asc por date_last_updated
    for (let i = 1; i < refs.length; i++) {
      expect(new Date(refs[i].date_last_updated).getTime()).toBeGreaterThanOrEqual(
        new Date(refs[i - 1].date_last_updated).getTime(),
      );
    }
  });

  it('pagina o delta quando ele excede uma página (backlog grande pós-bootstrap)', async () => {
    // 120 pedidos no delta (date_asc do servidor) → 3 páginas de 50.
    const delta = ordersAsc(120, '2026-06-10T00:00:00Z');
    const getOrders = jest.fn(async ({ offset, limit }: any) => delta.slice(offset, offset + limit));
    const { provider } = build(getOrders);

    const refs = await provider.listOrdersSince(MKT, new Date('2026-06-01T00:00:00Z'));

    expect(refs).toHaveLength(120);
    expect(getOrders.mock.calls.length).toBe(3); // 50 + 50 + 20
  });

  it('retorna [] quando o marketplace não tem adapter de pedidos', async () => {
    const getOrders = jest.fn();
    const adapters = {
      hasOrderAdapter: jest.fn().mockReturnValue(false),
      getOrderAdapter: jest.fn(),
    };
    const registry = { findOne: jest.fn().mockResolvedValue({ _id: MKT, name: ML }) };
    const provider = new MarketplaceOrderGatewayProvider(registry as any, adapters as any);

    expect(await provider.listOrdersSince(MKT, new Date())).toEqual([]);
    expect(getOrders).not.toHaveBeenCalled();
  });
});

describe('MarketplaceOrderGatewayProvider.fetchOrder', () => {
  const MKT = '650000000000000000000099';

  it('propaga mkt.tag (tag técnica) além de mkt.name (nome de exibição) — resolução fiscal depende da tag', async () => {
    const getOrderDetails = jest.fn().mockResolvedValue({ id: 'O1', status: 'paid', total_amount: 10 });
    const adapter = { getOrderDetails };
    const registry = { findOne: jest.fn().mockResolvedValue({ _id: MKT, name: 'Mercado Livre', tag: 'mercadolivre' }) };
    const adapters = {
      hasOrderAdapter: jest.fn().mockReturnValue(true),
      getOrderAdapter: jest.fn().mockReturnValue(adapter),
    };
    const provider = new MarketplaceOrderGatewayProvider(registry as any, adapters as any);

    const result = await provider.fetchOrder('O1', MKT);

    expect(result?.marketplaceName).toBe('Mercado Livre');
    expect(result?.marketplaceTag).toBe('mercadolivre');
  });
});
