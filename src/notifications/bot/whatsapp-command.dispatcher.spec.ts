import { WhatsAppCommandDispatcher } from './whatsapp-command.dispatcher';

describe('WhatsAppCommandDispatcher', () => {
  const balanceMl = { execute: jest.fn() };
  const sales = { execute: jest.fn() };
  const pendingOrders = { execute: jest.fn() };
  const movementsMl = { execute: jest.fn() };
  const productSearch = { execute: jest.fn() };

  let dispatcher: WhatsAppCommandDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatcher = new WhatsAppCommandDispatcher(
      balanceMl as any,
      sales as any,
      pendingOrders as any,
      movementsMl as any,
      productSearch as any,
    );
  });

  it('pede termo quando comando buscar produto chega sem termo', async () => {
    const result = await dispatcher.execute('SEARCH_PRODUCT');
    expect(result).toContain('Informe a busca do produto');
    expect(productSearch.execute).not.toHaveBeenCalled();
  });

  it('executa busca quando comando buscar produto recebe termo', async () => {
    productSearch.execute.mockResolvedValue('resultado');
    const result = await dispatcher.execute('SEARCH_PRODUCT', { searchTerm: 'Roda Onix' });
    expect(productSearch.execute).toHaveBeenCalledWith('Roda Onix');
    expect(result).toBe('resultado');
  });
});
