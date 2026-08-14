import { WhatsAppCommandDispatcher } from './whatsapp-command.dispatcher';

describe('WhatsAppCommandDispatcher', () => {
  const sales = { getSalesReport: jest.fn(), getPendingOrders: jest.fn() };
  const balance = { getMlBalance: jest.fn(), getMlMovements: jest.fn() };
  const productInfo = { searchProduct: jest.fn() };

  let dispatcher: WhatsAppCommandDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatcher = new WhatsAppCommandDispatcher(
      sales as any,
      balance as any,
      productInfo as any,
    );
  });

  it('pede termo quando comando buscar produto chega sem termo', async () => {
    const result = await dispatcher.execute('SEARCH_PRODUCT');
    expect(result).toContain('Informe a busca do produto');
    expect(productInfo.searchProduct).not.toHaveBeenCalled();
  });

  it('executa busca quando comando buscar produto recebe termo', async () => {
    productInfo.searchProduct.mockResolvedValue('resultado');
    const result = await dispatcher.execute('SEARCH_PRODUCT', { searchTerm: 'Roda Onix' });
    expect(productInfo.searchProduct).toHaveBeenCalledWith('Roda Onix');
    expect(result).toBe('resultado');
  });

  it('roteia vendas e saldo para os ports corretos', async () => {
    sales.getSalesReport.mockResolvedValue('vendas');
    balance.getMlBalance.mockResolvedValue('saldo');

    expect(await dispatcher.execute('SALES_TODAY')).toBe('vendas');
    expect(sales.getSalesReport).toHaveBeenCalledWith('today');

    expect(await dispatcher.execute('BALANCE_ML')).toBe('saldo');
    expect(balance.getMlBalance).toHaveBeenCalled();
  });
});
