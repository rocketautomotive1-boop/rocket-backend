import { ProductSearchQuery } from './product-search.query';

describe('ProductSearchQuery', () => {
  const productModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const stockMovementModel = {
    aggregate: jest.fn(),
    findOne: jest.fn(),
  };

  const stockQuery = {
    getProductStock: jest.fn().mockResolvedValue({ onHand: 3, reserved: 0, available: 3, productId: 'p1' }),
  };

  let query: ProductSearchQuery;

  beforeEach(() => {
    jest.clearAllMocks();
    stockQuery.getProductStock.mockResolvedValue({ onHand: 3, reserved: 0, available: 3, productId: 'p1' });
    query = new ProductSearchQuery(productModel as any, stockMovementModel as any, stockQuery as any);
  });

  it('retorna produto com estoque quando encontra por match exato', async () => {
    productModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: 'p1', name: 'Roda Onix', partNumber: 'ROD-ONIX', active: true, price: { toString: () => '199.9' } }) }),
    });
    stockMovementModel.aggregate.mockResolvedValue([{ _id: 'p1', total: 3 }]);
    stockMovementModel.findOne.mockReturnValue({
      sort: () => ({
        lean: () => ({
          exec: () => Promise.resolve({ type: 'outbound', quantity: 1, date: new Date('2026-04-01T10:00:00.000Z') }),
        }),
      }),
    });

    const result = await query.execute('Roda Onix');
    expect(result).toContain('Roda Onix');
    expect(result).toContain('ROD-ONIX');
    expect(result).toContain('Estoque');
  });

  it('retorna sugestões quando nao encontra match exato', async () => {
    productModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(null) }),
    });
    productModel.find.mockReturnValue({
      limit: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve([
              { _id: 'p1', name: 'Roda Onix Aro 15', partNumber: 'RODA-15', active: true },
              { _id: 'p2', name: 'Roda Onix Aro 16', partNumber: 'RODA-16', active: false },
            ]),
        }),
      }),
    });
    stockMovementModel.aggregate.mockResolvedValue([{ _id: 'p1', total: 5 }]);
    stockMovementModel.findOne.mockReturnValue({
      sort: () => ({
        lean: () => ({
          exec: () => Promise.resolve(null),
        }),
      }),
    });

    const result = await query.execute('Roda Onix');
    expect(result).toContain('Resultados para');
    expect(result).toContain('Roda Onix Aro 15');
  });

  it('retorna mensagem amigavel quando nao encontra produtos', async () => {
    productModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(null) }),
    });
    productModel.find.mockReturnValue({
      limit: () => ({
        lean: () => ({ exec: () => Promise.resolve([]) }),
      }),
    });

    const result = await query.execute('xpto');
    expect(result).toContain('Nenhum produto encontrado');
  });
});
