import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { OrderModel } from '../schemas/order.schema';
import { ORDER_EVENTS, OrderPricingCalculatedEvent } from '../events/order.events';

/**
 * Reconciliador de notificações de venda (vive em order/, dono dos pedidos).
 * Re-emite ORDER_EVENTS.PRICING_CALCULATED para pedidos sem notificação — o
 * OrderSaleNotificationListener reprocessa e o broker reenvia ao WhatsApp.
 */
@Injectable()
export class SaleNotificationReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(SaleNotificationReconcilerService.name);
  private readonly LOOKBACK_DAYS = 7;

  constructor(
    @InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.backfillLegacyWhatsappSentStatus();
    setTimeout(() => {
      this.reconcile().catch(err =>
        this.logger.error(`Startup reconciliation failed: ${err.message}`),
      );
    }, 20_000);
  }

  @Cron('0 */15 * * * *')
  async handleCron(): Promise<void> {
    await this.reconcile();
  }

  /** Reenvia a notificação de uma venda. Aceita externalId ou ObjectId. */
  async resend(orderId: string): Promise<{ ok: boolean; message: string }> {
    const query = Types.ObjectId.isValid(orderId)
      ? { _id: new Types.ObjectId(orderId) }
      : { externalId: orderId };

    const order = await this.orderModel.findOne(query).lean().exec();

    if (!order) return { ok: false, message: `Order ${orderId} not found` };
    if (!order.pricing) return { ok: false, message: `Order ${order.externalId} has no pricing data yet` };

    await this.orderModel.updateOne(query, {
      $unset: {
        'notificationStatus.whatsapp.sentAt': 1,
        'notificationStatus.whatsapp.error': 1,
      },
      $set: {
        'notificationStatus.whatsapp.status': 'pending',
        'notificationStatus.whatsapp.reason': 'manual_resend',
        'notificationStatus.whatsapp.nextRetryAt': new Date(),
      },
    });

    this.eventEmitter.emit(
      ORDER_EVENTS.PRICING_CALCULATED,
      new OrderPricingCalculatedEvent(
        String(order._id),
        order.externalId,
        String(order.marketplaceId),
        '',
        order.pricing,
        'manual',
      ),
    );

    this.logger.log(`Manual resend triggered for order ${order.externalId}`);
    return { ok: true, message: `WhatsApp notification re-queued for order ${order.externalId}` };
  }

  private async reconcile(): Promise<void> {
    const maxAutoAgeHours = this.getNumberEnv('WHATSAPP_NOTIFICATION_MAX_AUTO_AGE_HOURS', 24);
    const since = new Date();
    since.setDate(since.getDate() - this.LOOKBACK_DAYS);
    const oldestForAuto = new Date(
      Math.max(since.getTime(), Date.now() - maxAutoAgeHours * 60 * 60 * 1000),
    );

    const orders = await this.orderModel
      .find({
        logisticsStatus: 'deducted',
        pricing: { $exists: true },
        createdAt: { $gte: oldestForAuto, $lte: new Date() },
        $or: [
          { 'notificationStatus.whatsapp.status': { $exists: false } },
          { 'notificationStatus.whatsapp.status': { $in: ['pending', 'failed'] } },
        ],
        'notificationStatus.whatsapp.status': { $nin: ['sent', 'skipped_old', 'manual_required'] },
      })
      .lean()
      .exec();

    if (!orders.length) return;

    this.logger.warn(`Reconciler: ${orders.length} order(s) missing WhatsApp notification — re-emitting`);

    for (const order of orders) {
      try {
        await this.orderModel.findByIdAndUpdate(order._id, {
          'notificationStatus.whatsapp.status': 'queued',
          'notificationStatus.whatsapp.lastAttemptAt': new Date(),
          $inc: { 'notificationStatus.whatsapp.attempts': 1 },
        });
        this.eventEmitter.emit(
          ORDER_EVENTS.PRICING_CALCULATED,
          new OrderPricingCalculatedEvent(
            String(order._id),
            order.externalId,
            String(order.marketplaceId),
            '',
            order.pricing,
          ),
        );
        this.logger.log(`Reconciler: re-emitted PRICING_CALCULATED for order ${order.externalId}`);
      } catch (err) {
        await this.orderModel.findByIdAndUpdate(order._id, {
          'notificationStatus.whatsapp.status': 'failed',
          'notificationStatus.whatsapp.error': err.message,
          'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        });
        this.logger.error(`Reconciler: failed for order ${order.externalId}: ${err.message}`);
      }
    }
  }

  private getNumberEnv(key: string, defaultValue: number): number {
    const raw = this.configService.get<string | number | undefined>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  private async backfillLegacyWhatsappSentStatus(): Promise<void> {
    const result = await this.orderModel.updateMany(
      {
        'financialSnapshot.whatsappSentAt': { $exists: true },
        $or: [
          { 'notificationStatus.whatsapp.status': { $exists: false } },
          { 'notificationStatus.whatsapp.status': { $ne: 'sent' } },
        ],
      },
      {
        $set: {
          'notificationStatus.whatsapp.status': 'sent',
          'notificationStatus.whatsapp.reason': 'legacy_migration',
          'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        },
      },
    );

    const modified = (result as any).modifiedCount ?? 0;
    if (modified > 0) {
      this.logger.log(`Reconciler backfill: migrated ${modified} legacy whatsappSentAt records to notificationStatus.`);
    }
  }
}
