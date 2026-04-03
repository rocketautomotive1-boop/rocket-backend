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
    const { orderId, externalId, pricing, triggeredBy } = event;

    // Só notifica vendas que chegaram via webhook em tempo real ou reenvio manual explícito.
    // Sincronizações retroativas (cron, sync, retry) não devem disparar notificação de "nova venda".
    if (triggeredBy !== 'webhook' && triggeredBy !== 'manual') {
      this.logger.debug(`Skipping WhatsApp notification for order ${externalId} (triggeredBy=${triggeredBy})`);
      return;
    }

    try {
      this.logger.debug(`Sending WhatsApp notification for order ${externalId}`);

      const order = await this.orderModel.findById(orderId).exec();
      if (!order) {
        this.logger.warn(`Order ${orderId} not found for notification`);
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
        'financialSnapshot.whatsappSentAt': new Date(),
      });

      this.logger.debug(`WhatsApp notification queued for order ${externalId}`);
    } catch (error) {
      this.logger.error(
        `Error sending WhatsApp notification for order ${externalId}: ${error.message}`,
        error.stack
      );
    }
  }
}
