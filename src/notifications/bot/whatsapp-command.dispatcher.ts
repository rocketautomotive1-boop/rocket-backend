import { Inject, Injectable } from '@nestjs/common';
import { CommandIntent } from './whatsapp-command.router';
import {
  SALES_QUERY_PORT, SalesQueryPort,
  BALANCE_QUERY_PORT, BalanceQueryPort,
  PRODUCT_INFO_QUERY_PORT, ProductInfoQueryPort,
} from './ports/bot-query.ports';

const HELP_TEXT = [
  `🤖 *Comandos disponíveis:*`,
  `• saldo ml — Saldo Mercado Pago`,
  `• saldo shopee — Saldo Shopee`,
  `• vendas hoje / semana — Relatório de vendas`,
  `• pedidos pendentes — Aguardando envio`,
  `• movimentações hoje — Extrato do Mercado Pago`,
  `• buscar produto [termo] — Consulta produto e estoque`,
].join('\n');

/**
 * Roteia a intent para o read-port apropriado (implementado pelo domínio).
 * Não conhece OrderModel/StockModule/MarketplaceAuth — só os ports.
 */
@Injectable()
export class WhatsAppCommandDispatcher {
  constructor(
    @Inject(SALES_QUERY_PORT) private readonly sales: SalesQueryPort,
    @Inject(BALANCE_QUERY_PORT) private readonly balance: BalanceQueryPort,
    @Inject(PRODUCT_INFO_QUERY_PORT) private readonly productInfo: ProductInfoQueryPort,
  ) {}

  async execute(
    intent: CommandIntent,
    options?: { searchTerm?: string },
  ): Promise<string | null> {
    switch (intent) {
      case 'BALANCE_ML':      return this.balance.getMlBalance();
      case 'BALANCE_SHOPEE':  return `🔜 Saldo Shopee ainda não disponível.`;
      case 'BALANCE_ALL':     return this.balance.getMlBalance();
      case 'SALES_TODAY':     return this.sales.getSalesReport('today');
      case 'SALES_WEEK':      return this.sales.getSalesReport('week');
      case 'ORDERS_PENDING':  return this.sales.getPendingOrders();
      case 'MOVEMENTS_ML':    return this.balance.getMlMovements();
      case 'SEARCH_PRODUCT':
        if (!options?.searchTerm?.trim()) {
          return `🔎 Informe a busca do produto.\nEx.: *Roda Onix*`;
        }
        return this.productInfo.searchProduct(options.searchTerm);
      case 'HELP':            return HELP_TEXT;
      case 'UNKNOWN':         return null;
    }
  }
}
