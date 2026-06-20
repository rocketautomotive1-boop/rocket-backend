import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ORDER_EVENTS,
  OrderPricingCalculatedEvent,
  OrderSaleNotificationEvent,
} from '../events/order.events';
import { OrderModel } from '../schemas/order.schema';
import { OrderFinancialSummaryService } from '../services/order-financial-summary.service';

/**
 * Dono da lógica de NEGÓCIO da notificação de venda (vive em order/).
 *
 * Resolve o financeiro preciso (ML billing → details → payment → pricing), aplica
 * guardas de idade/idempotência, persiste snapshot e marca notificationStatus.
 * Emite OrderSaleNotificationEvent autocontido — quem formata/envia é o broker
 * (notifications), que NÃO lê OrderModel. Substitui o antigo WhatsAppNotificationListener.
 */
@Injectable()
export class OrderSaleNotificationListener {
  private readonly logger = new Logger(OrderSaleNotificationListener.name);
  private readonly AGE_LIMIT_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel('OrderModel') private readonly orderModel: Model<OrderModel>,
    private readonly financialSummaryService: OrderFinancialSummaryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(ORDER_EVENTS.PRICING_CALCULATED, { async: true })
  async handlePricingCalculated(event: OrderPricingCalculatedEvent): Promise<void> {
    const { orderId, externalId, pricing, triggeredBy = 'sync' } = event;

    try {
      const order = await this.orderModel.findById(orderId).exec();
      if (!order) {
        this.logger.warn(`Order ${orderId} not found for notification`);
        return;
      }

      // Idempotência: já notificado → só reenvio manual força de novo.
      const alreadySent = order.notificationStatus?.whatsapp?.status === 'sent';
      if (alreadySent && triggeredBy !== 'manual') {
        this.logger.debug(`Order ${externalId} already notified — skipping`);
        return;
      }

      // Pedidos antigos só notificam em reenvio manual (evita spam de importação histórica).
      const orderAge = Date.now() - new Date((order as any).createdAt ?? 0).getTime();
      if (orderAge > this.AGE_LIMIT_MS && triggeredBy !== 'manual') {
        await this.orderModel.findByIdAndUpdate(orderId, {
          'notificationStatus.whatsapp.status': 'skipped_old',
          'notificationStatus.whatsapp.reason': `order_age_gt_${Math.round(this.AGE_LIMIT_MS / 3600000)}h`,
          'notificationStatus.whatsapp.lastAttemptAt': new Date(),
          $inc: { 'notificationStatus.whatsapp.attempts': 1 },
        });
        this.logger.debug(`Order ${externalId} is too old (${Math.round(orderAge / 3600000)}h) — skipping`);
        return;
      }

      // Financeiro preciso (ML billing API > marketplace details > order.payment > pricing).
      const financial = await this.financialSummaryService.getFinancialSummary(order, pricing);

      // Snapshot para queries agregadas (relatório/vendas).
      await this.orderModel.findByIdAndUpdate(orderId, {
        financialSnapshot: {
          gross: financial.gross,
          commission: financial.saleFee,
          freight: financial.freight,
          taxes: financial.taxes,
          coupon: financial.coupon,
          net: financial.net,
          costTotal: financial.costTotal,
          grossProfit: financial.grossProfit,
          marginPct: financial.marginPct,
          resolvedAt: new Date(),
        },
      });

      // Monta payload autocontido de itens.
      const orderItems: any[] = (order as any).items ?? (order as any).order_items ?? [];
      const firstItemTitle = orderItems[0]?.title || pricing.items?.[0]?.title || 'Produto';
      const firstQty = Number(orderItems[0]?.quantity ?? pricing.items?.[0]?.quantity ?? 1);
      const firstUnitPrice = Number(orderItems[0]?.unitPrice ?? pricing.items?.[0]?.unitPrice ?? 0);
      const itemsTotal = orderItems.length > 0
        ? orderItems.reduce((sum, it) => sum + Number(it?.quantity || 0) * Number(it?.unitPrice || 0), 0)
        : Number(pricing.totals?.grossRevenue || financial.gross || 0);

      this.eventEmitter.emit(
        ORDER_EVENTS.SALE_NOTIFICATION,
        new OrderSaleNotificationEvent(
          String(order._id),
          order.externalId,
          String(pricing.marketplace ?? (order as any).marketplace ?? ''),
          new Date((order as any).createdAt ?? Date.now()).toISOString(),
          (order as any).customer?.name || 'N/A',
          firstItemTitle,
          orderItems.length > 1 ? orderItems.length - 1 : 0,
          firstQty,
          firstUnitPrice,
          itemsTotal,
          {
            gross: financial.gross,
            saleFee: financial.saleFee,
            freight: financial.freight,
            taxes: financial.taxes,
            coupon: financial.coupon,
            net: financial.net,
            costTotal: financial.costTotal,
            grossProfit: financial.grossProfit,
            marginPct: financial.marginPct,
          },
          triggeredBy,
        ),
      );

      await this.orderModel.findByIdAndUpdate(orderId, {
        'notificationStatus.whatsapp.status': 'sent',
        'notificationStatus.whatsapp.sentAt': new Date(),
        'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        'notificationStatus.whatsapp.error': null,
        'notificationStatus.whatsapp.reason': null,
        $inc: { 'notificationStatus.whatsapp.attempts': 1 },
      });

      this.logger.debug(`Sale notification emitted for order ${externalId}`);
    } catch (error) {
      await this.orderModel.findByIdAndUpdate(orderId, {
        'notificationStatus.whatsapp.status': 'failed',
        'notificationStatus.whatsapp.error': error.message,
        'notificationStatus.whatsapp.lastAttemptAt': new Date(),
        $inc: { 'notificationStatus.whatsapp.attempts': 1 },
      });
      this.logger.error(
        `Error emitting sale notification for order ${externalId}: ${error.message}`,
        error.stack,
      );
    }
  }
}
