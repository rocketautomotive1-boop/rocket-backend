import { Injectable } from '@nestjs/common';
import { CommandIntent } from './whatsapp-command.router';
import { BalanceMlQuery } from './queries/balance-ml.query';
import { SalesQuery } from './queries/sales.query';
import { PendingOrdersQuery } from './queries/pending-orders.query';
import { MovementsMlQuery } from './queries/movements-ml.query';
import { ProductSearchQuery } from './queries/product-search.query';

const HELP_TEXT = [
  `🤖 *Comandos disponíveis:*`,
  `• saldo ml — Saldo Mercado Pago`,
  `• saldo shopee — Saldo Shopee`,
  `• vendas hoje / semana — Relatório de vendas`,
  `• pedidos pendentes — Aguardando envio`,
  `• movimentações hoje — Extrato do Mercado Pago`,
  `• buscar produto [termo] — Consulta produto e estoque`,
].join('\n');

@Injectable()
export class WhatsAppCommandDispatcher {
  constructor(
    private readonly balanceMl: BalanceMlQuery,
    private readonly sales: SalesQuery,
    private readonly pendingOrders: PendingOrdersQuery,
    private readonly movementsMl: MovementsMlQuery,
    private readonly productSearch: ProductSearchQuery,
  ) {}

  async execute(
    intent: CommandIntent,
    options?: { searchTerm?: string },
  ): Promise<string | null> {
    switch (intent) {
      case 'BALANCE_ML':      return this.balanceMl.execute();
      case 'BALANCE_SHOPEE':  return `🔜 Saldo Shopee ainda não disponível.`;
      case 'BALANCE_ALL':     return this.balanceMl.execute();
      case 'SALES_TODAY':     return this.sales.execute('today');
      case 'SALES_WEEK':      return this.sales.execute('week');
      case 'ORDERS_PENDING':  return this.pendingOrders.execute();
      case 'MOVEMENTS_ML':    return this.movementsMl.execute();
      case 'SEARCH_PRODUCT':
        if (!options?.searchTerm?.trim()) {
          return `🔎 Informe a busca do produto.\nEx.: *Roda Onix*`;
        }
        return this.productSearch.execute(options.searchTerm);
      case 'HELP':            return HELP_TEXT;
      case 'UNKNOWN':         return null;
    }
  }
}
