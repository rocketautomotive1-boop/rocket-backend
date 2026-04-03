import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderModel } from '../../../order/schemas/order.schema';

@Injectable()
export class PendingOrdersQuery {
  private readonly logger = new Logger(PendingOrdersQuery.name);
  private readonly MAX_RESULTS = 10;

  constructor(@InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>) {}

  async execute(): Promise<string> {
    try {
      const orders = await this.orderModel
        .find({ status: 'paid' })
        .sort({ createdAt: -1 })
        .limit(this.MAX_RESULTS)
        .lean()
        .exec();

      if (!orders.length) {
        return `📬 Nenhum pedido aguardando envio.`;
      }

      const lines = [
        `📬 *Pedidos Aguardando Envio* (${orders.length}${orders.length === this.MAX_RESULTS ? '+' : ''})`,
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
      this.logger.error(`PendingOrdersQuery failed: ${err.message}`);
      return `❌ Erro ao buscar pedidos: ${err.message}`;
    }
  }
}
