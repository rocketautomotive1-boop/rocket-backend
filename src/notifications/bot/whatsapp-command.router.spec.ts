import { WhatsAppCommandRouter } from './whatsapp-command.router';

describe('WhatsAppCommandRouter', () => {
  let router: WhatsAppCommandRouter;
  beforeEach(() => { router = new WhatsAppCommandRouter(); });

  it.each([
    ['saldo ml', 'BALANCE_ML'],
    ['Saldo Mercado Livre', 'BALANCE_ML'],
    ['saldo mercadolivre', 'BALANCE_ML'],
    ['SALDO ML', 'BALANCE_ML'],
    ['saldo shopee', 'BALANCE_SHOPEE'],
    ['qual o saldo?', 'BALANCE_ALL'],
    ['saldo', 'BALANCE_ALL'],
    ['vendas hoje', 'SALES_TODAY'],
    ['vendas do dia', 'SALES_TODAY'],
    ['vendas semana', 'SALES_WEEK'],
    ['vendas da semana', 'SALES_WEEK'],
    ['pedidos pendentes', 'ORDERS_PENDING'],
    ['pedidos aguardando envio', 'ORDERS_PENDING'],
    ['pedidos aguardando', 'ORDERS_PENDING'],
    ['ajuda', 'HELP'],
    ['help', 'HELP'],
    ['comandos', 'HELP'],
    ['boa tarde', 'UNKNOWN'],
    ['ok', 'UNKNOWN'],
  ])('"%s" → %s', (input, expected) => {
    expect(router.route(input)).toBe(expected);
  });
});
