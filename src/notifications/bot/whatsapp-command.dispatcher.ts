import { Injectable } from '@nestjs/common';
import { CommandIntent } from './whatsapp-command.router';
import { BalanceMlQuery } from './queries/balance-ml.query';
import { SalesQuery } from './queries/sales.query';
import { PendingOrdersQuery } from './queries/pending-orders.query';
import { MovementsMlQuery } from './queries/movements-ml.query';

const HELP_TEXT = [
  `🤖 *Comandos disponíveis:*`,
  `• saldo ml — Saldo Mercado Pago`,
  `• saldo shopee — Saldo Shopee`,
  `• vendas hoje / semana — Relatório de vendas`,
  `• pedidos pendentes — Aguardando envio`,
  `• movimentações hoje — Extrato do Mercado Pago`,
].join('\n');

@Injectable()
export class WhatsAppCommandDispatcher {
  constructor(
    private readonly balanceMl: BalanceMlQuery,
    private readonly sales: SalesQuery,
    private readonly pendingOrders: PendingOrdersQuery,
    private readonly movementsMl: MovementsMlQuery,
  ) {}

  async execute(intent: CommandIntent): Promise<string | null> {
    switch (intent) {
      case 'BALANCE_ML':      return this.balanceMl.execute();
      case 'BALANCE_SHOPEE':  return `🔜 Saldo Shopee ainda não disponível.`;
      case 'BALANCE_ALL':     return this.balanceMl.execute();
      case 'SALES_TODAY':     return this.sales.execute('today');
      case 'SALES_WEEK':      return this.sales.execute('week');
      case 'ORDERS_PENDING':  return this.pendingOrders.execute();
      case 'MOVEMENTS_ML':    return this.movementsMl.execute();
      case 'HELP':            return HELP_TEXT;
      case 'UNKNOWN':         return null;
    }
  }
}
