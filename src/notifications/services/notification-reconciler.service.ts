import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderModel } from '../../order/schemas/order.schema';
import { ORDER_EVENTS, OrderPricingCalculatedEvent } from '../../order/events/order.events';

@Injectable()
export class NotificationReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationReconcilerService.name);
  private readonly LOOKBACK_DAYS = 7;

  constructor(
    @InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    // Aguarda 20s para o app estabilizar antes da reconciliação de startup
    setTimeout(() => {
      this.reconcile().catch(err =>
        this.logger.error(`Startup reconciliation failed: ${err.message}`),
      );
    }, 20_000);
  }

  @Cron('0 */15 * * * *') // A cada 15 minutos
  async handleCron(): Promise<void> {
    await this.reconcile();
  }

  /**
   * Reenvia a notificação WhatsApp de uma venda específica.
   * Aceita externalId (ex: "2000015818700676") ou ObjectId.
   */
  async resend(orderId: string): Promise<{ ok: boolean; message: string }> {
    const query = Types.ObjectId.isValid(orderId)
      ? { _id: new Types.ObjectId(orderId) }
      : { externalId: orderId };

    const order = await this.orderModel.findOne(query).lean().exec();

    if (!order) {
      return { ok: false, message: `Order ${orderId} not found` };
    }

    if (!order.pricing) {
      return { ok: false, message: `Order ${order.externalId} has no pricing data yet` };
    }

    // Limpa whatsappSentAt para garantir que o listener processa
    await this.orderModel.updateOne(query, { $unset: { 'financialSnapshot.whatsappSentAt': 1 } });

    const event = new OrderPricingCalculatedEvent(
      String(order._id),
      order.externalId,
      String(order.marketplaceId),
      '',
      order.pricing,
      'manual', // reenvio manual — listener deve processar independente do triggeredBy
    );
    this.eventEmitter.emit(ORDER_EVENTS.PRICING_CALCULATED, event);

    this.logger.log(`Manual resend triggered for order ${order.externalId}`);
    return { ok: true, message: `WhatsApp notification re-queued for order ${order.externalId}` };
  }

  private async reconcile(): Promise<void> {
    const since = new Date();
    since.setDate(since.getDate() - this.LOOKBACK_DAYS);

    const orders = await this.orderModel
      .find({
        logisticsStatus: 'deducted',
        pricing: { $exists: true },
        'financialSnapshot.whatsappSentAt': { $exists: false },
        createdAt: { $gte: since },
      })
      .lean()
      .exec();

    if (!orders.length) return;

    this.logger.warn(`Reconciler: ${orders.length} order(s) missing WhatsApp notification — re-emitting`);

    for (const order of orders) {
      try {
        const event = new OrderPricingCalculatedEvent(
          String(order._id),
          order.externalId,
          String(order.marketplaceId),
          '',
          order.pricing,
        );
        this.eventEmitter.emit(ORDER_EVENTS.PRICING_CALCULATED, event);
        this.logger.log(`Reconciler: re-emitted PRICING_CALCULATED for order ${order.externalId}`);
      } catch (err) {
        this.logger.error(`Reconciler: failed for order ${order.externalId}: ${err.message}`);
      }
    }
  }
}
