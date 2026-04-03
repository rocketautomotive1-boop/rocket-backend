import { SalesQuery } from './sales.query';

const mockOrderModel = {
  aggregate: jest.fn(),
};

describe('SalesQuery', () => {
  let query: SalesQuery;

  beforeEach(() => {
    jest.clearAllMocks();
    query = new SalesQuery(mockOrderModel as any);
  });

  it('formata mensagem de hoje quando há vendas', async () => {
    mockOrderModel.aggregate.mockResolvedValue([
      { marketplace: 'Mercado Livre', count: 3, revenue: 900, profit: 180 },
      { marketplace: 'Shopee',        count: 1, revenue: 200, profit: 40  },
    ]);

    const result = await query.execute('today');

    expect(result).toContain('Vendas de Hoje');
    expect(result).toContain('4 pedidos');
    expect(result).toContain('1.100');
    expect(result).toContain('Mercado Livre: 3');
    expect(result).toContain('Shopee: 1');
  });

  it('formata mensagem da semana', async () => {
    mockOrderModel.aggregate.mockResolvedValue([
      { marketplace: 'Mercado Livre', count: 10, revenue: 5000, profit: 1000 },
    ]);
    const result = await query.execute('week');
    expect(result).toContain('Vendas da Semana');
    expect(result).toContain('10 pedidos');
  });

  it('retorna mensagem vazia quando não há vendas', async () => {
    mockOrderModel.aggregate.mockResolvedValue([]);
    const result = await query.execute('today');
    expect(result).toContain('Nenhuma venda');
  });
});
