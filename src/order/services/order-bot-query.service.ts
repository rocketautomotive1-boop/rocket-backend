import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderModel } from '../schemas/order.schema';
import { SalesQueryPort } from '../../notifications/bot/ports/bot-query.ports';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const PAID_STATUSES = ['paid', 'shipped', 'delivered', 'ready_to_ship', 'payment_done'];

interface SalesRow {
  marketplaceName: string;
  count: number;
  gross: number;
  commission: number;
  freight: number;
  taxes: number;
  net: number;
  profit: number;
}

/**
 * Implementação do SALES_QUERY_PORT (read-port do bot WhatsApp), dona dos dados de
 * pedidos. Vive em order/; o broker (notifications) só consome a interface.
 */
@Injectable()
export class OrderBotQueryService implements SalesQueryPort {
  private readonly logger = new Logger(OrderBotQueryService.name);
  private readonly MAX_PENDING = 10;

  constructor(@InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>) {}

  async getSalesReport(period: 'today' | 'week'): Promise<string> {
    try {
      const since = this.periodStart(period);

      const rows: SalesRow[] = await this.orderModel.aggregate([
        { $match: { status: { $in: PAID_STATUSES }, createdAt: { $gte: since } } },
        { $lookup: { from: 'marketplaces', localField: 'marketplaceId', foreignField: '_id', as: 'mkt' } },
        {
          $group: {
            _id: { $ifNull: [{ $arrayElemAt: ['$mkt.name', 0] }, 'Outro'] },
            count: { $sum: 1 },
            gross: { $sum: { $ifNull: ['$financialSnapshot.gross', '$totalAmount'] } },
            commission: { $sum: { $ifNull: ['$financialSnapshot.commission', 0] } },
            freight: { $sum: { $ifNull: ['$financialSnapshot.freight', 0] } },
            taxes: { $sum: { $ifNull: ['$financialSnapshot.taxes', 0] } },
            net: { $sum: { $ifNull: ['$financialSnapshot.net', '$totalAmount'] } },
            profit: { $sum: { $ifNull: ['$financialSnapshot.grossProfit', '$pricing.totals.totalNetProfit'] } },
          },
        },
        {
          $project: {
            marketplaceName: '$_id',
            count: 1, gross: 1, commission: 1, freight: 1, taxes: 1, net: 1, profit: 1,
            _id: 0,
          },
        },
        { $sort: { gross: -1 } },
      ]);

      if (!rows.length) {
        const label = period === 'today' ? 'hoje' : 'esta semana';
        return `📊 Nenhuma venda registrada ${label}.`;
      }

      const T = rows.reduce(
        (a, r) => ({
          count: a.count + r.count,
          gross: a.gross + (r.gross ?? 0),
          commission: a.commission + (r.commission ?? 0),
          freight: a.freight + (r.freight ?? 0),
          taxes: a.taxes + (r.taxes ?? 0),
          net: a.net + (r.net ?? 0),
          profit: a.profit + (r.profit ?? 0),
        }),
        { count: 0, gross: 0, commission: 0, freight: 0, taxes: 0, net: 0, profit: 0 },
      );

      const title = period === 'today' ? 'Vendas de Hoje' : 'Vendas da Semana';

      const lines = [
        `💹 *${title}*`,
        `📦 ${T.count} pedidos`,
        ``,
        `💰 Valor bruto: ${fmt(T.gross)}`,
        ...(T.commission > 0 ? [`  └ Comissão: -${fmt(T.commission)}`] : []),
        ...(T.freight > 0 ? [`  └ Frete: -${fmt(T.freight)}`] : []),
        ...(T.taxes > 0 ? [`  └ Impostos: -${fmt(T.taxes)}`] : []),
        `💵 Receita líquida: ${fmt(T.net)}`,
        ...(T.profit > 0 ? [`✅ Lucro estimado: ${fmt(T.profit)}`] : []),
        ``,
        `*Por marketplace:*`,
        ...rows.map(r =>
          `  └ ${r.marketplaceName}: ${r.count} · ${fmt(r.gross)} bruto · líq. ${fmt(r.net)}`,
        ),
      ];

      return lines.join('\n');
    } catch (err) {
      this.logger.error(`getSalesReport failed: ${err.message}`);
      return `❌ Erro ao buscar vendas: ${err.message}`;
    }
  }

  async getPendingOrders(): Promise<string> {
    try {
      const orders = await this.orderModel
        .find({ status: 'paid' })
        .sort({ createdAt: -1 })
        .limit(this.MAX_PENDING)
        .lean()
        .exec();

      if (!orders.length) {
        return `📬 Nenhum pedido aguardando envio.`;
      }

      const lines = [
        `📬 *Pedidos Aguardando Envio* (${orders.length}${orders.length === this.MAX_PENDING ? '+' : ''})`,
        ...orders.map(o => {
          const items: any[] = (o as any).items ?? [];
          const title = items[0]?.title ?? 'Produto';
          const buyer = (o as any).customer?.name ?? 'N/D';
          const shortName = buyer.split(' ').slice(0, 2).join(' ');
          return `• ${(o as any).externalId} — ${title} — ${shortName}`;
        }),
      ];

      return lines.join('\n');
    } catch (err) {
      this.logger.error(`getPendingOrders failed: ${err.message}`);
      return `❌ Erro ao buscar pedidos: ${err.message}`;
    }
  }

  private periodStart(period: 'today' | 'week'): Date {
    const now = new Date();
    if (period === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}
