import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ORDER_EVENTS, OrderPricingCalculatedEvent } from '../../order/events/order.events';
import { WhatsAppNotificationService } from '../services/whatsapp-notification.service';
import { OrderModel } from '../../order/schemas/order.schema';
import { OrderFinancialSummaryService } from '../../order/services/order-financial-summary.service';

/**
 * Listener que dispara notificação WhatsApp após ORDER_PRICING_CALCULATED.
 * Busca dados financeiros precisos via OrderFinancialSummaryService antes de notificar.
 */
@Injectable()
export class WhatsAppNotificationListener {
  private logger = new Logger(WhatsAppNotificationListener.name);

  constructor(
    @InjectModel('OrderModel') private orderModel: Model<OrderModel>,
    private whatsappService: WhatsAppNotificationService,
    private financialSummaryService: OrderFinancialSummaryService,
  ) {}

  @OnEvent(ORDER_EVENTS.PRICING_CALCULATED, { async: true })
  async handlePricingCalculated(event: OrderPricingCalculatedEvent): Promise<void> {
    const { orderId, externalId, pricing, triggeredBy = 'sync' } = event;

    // Reconcile (backfill histórico) nunca notifica — evita spam de vendas antigas
    // e a chamada cara à billing API. O estoque/Order/pricing seguem normalmente.
    if (triggeredBy === 'reconcile') {
      this.logger.debug(`Order ${externalId} reconciled (historical) — skipping WhatsApp notification`);
      return;
    }

    try {
      const order = await this.orderModel.findById(orderId).exec();
      if (!order) {
        this.logger.warn(`Order ${orderId} not found for notification`);
        return;
      }

      // Já foi notificado — só reenvio manual (triggeredBy='manual') pode forçar de novo
      const alreadySent = order.notificationStatus?.whatsapp?.status === 'sent';
      if (alreadySent && triggeredBy !== 'manual') {
        this.logger.debug(`Order ${externalId} already notified — skipping`);
        return;
      }

      // Pedidos antigos (> 24h) só são notificados em reenvio manual explícito.
      // Isso evita spam de importações históricas em lote.
      const AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
      const orderAge = Date.now() - new Date((order as any).createdAt ?? 0).getTime();
      if (orderAge > AGE_LIMIT_MS && triggeredBy !== 'manual') {
        await this.orderModel.findByIdAndUpdate(orderId, {
          'notificationStatus.whatsapp.status': 'skipped_old',
          'notificationStatus.whatsapp.reason': `order_age_gt_${Math.round(AGE_LIMIT_MS / 3600000)}h`,
          'notificationStatus.whatsapp.lastAttemptAt': new Date(),
          $inc: { 'notificationStatus.whatsapp.attempts': 1 },
        });
        this.logger.debug(`Order ${externalId} is too old (${Math.round(orderAge / 3600000)}h) — skipping`);
        return;
      }

      // Busca dados financeiros precisos (ML billing API > marketplace details > order.payment > pricing)
      const financial = await this.financialSummaryService.getFinancialSummary(order, pricing);

      // Persiste snapshot para uso em queries agregadas (ex: SalesQuery)
      await this.orderModel.findByIdAndUpdate(orderId, {
        financialSnapshot: {
          gross:       financial.gross,
          commission:  financial.saleFee,
          freight:     financial.freight,
          taxes:       financial.taxes,
          coupon:      financial.coupon,
          net:         financial.net,
          costTotal:   financial.costTotal,
          grossProfit: financial.grossProfit,
          marginPct:   financial.marginPct,
          resolvedAt:  new Date(),
        },
      });

      await this.whatsappService.sendSaleNotification(order, pricing, financial);

      // Marca que a notificação foi disparada — usado pelo reconciliador
      await this.orderModel.findByIdAndUpdate(orderId, {
        'notificationStatus.whatsapp.status': 'sent',
        'notificationStatus.whatsapp.sentAt': new Date(),
        'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        'notificationStatus.whatsapp.error': null,
        'notificationStatus.whatsapp.reason': null,
        $inc: { 'notificationStatus.whatsapp.attempts': 1 },
      });

      this.logger.debug(`WhatsApp notification queued for order ${externalId}`);
    } catch (error) {
      await this.orderModel.findByIdAndUpdate(orderId, {
        'notificationStatus.whatsapp.status': 'failed',
        'notificationStatus.whatsapp.error': error.message,
        'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        $inc: { 'notificationStatus.whatsapp.attempts': 1 },
      });
      this.logger.error(
        `Error sending WhatsApp notification for order ${externalId}: ${error.message}`,
        error.stack
      );
    }
  }
}
