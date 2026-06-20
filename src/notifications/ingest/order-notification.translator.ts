import { Injectable } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  ORDER_EVENTS,
  OrderProcessedEvent,
  OrderCancelledEvent,
  OrderSaleNotificationEvent,
} from '../../order/events/order.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationRequested } from '../contracts/notification-requested.event';
import { formatSaleMessage } from '../format/sale-message.formatter';
import { formatCancellationMessage } from '../format/cancellation-message.formatter';

/**
 * Ponte order → notifications. Importa SOMENTE os tipos de evento de order
 * (não o OrderModule). Converte eventos de domínio em NotificationRequested,
 * incluindo o texto WhatsApp já formatado quando aplicável.
 */
@Injectable()
export class OrderNotificationTranslator {
  constructor(private readonly emitter: EventEmitter2) {}

  @OnEvent(ORDER_EVENTS.PROCESSED, { async: true })
  onProcessed(event: OrderProcessedEvent): void {
    const req: NotificationRequested = {
      type: 'order.processed', aggregateType: 'order', aggregateId: event.orderId,
      title: `Nova venda - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} recebido`,
      severity: 'success',
      deduplicationKey: `order.processed:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy as any,
      data: {
        externalId: event.externalId, marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName, totalAmount: event.totalAmount,
        itemCount: event.items?.length || 0, actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }

  /**
   * Venda com financeiro resolvido → notificação WhatsApp (texto já formatado aqui).
   * O canal WhatsApp só enfileira o body; reenvio manual ignora dedup.
   */
  @OnEvent(ORDER_EVENTS.SALE_NOTIFICATION, { async: true })
  onSaleNotification(event: OrderSaleNotificationEvent): void {
    const body = formatSaleMessage({
      marketplace: event.marketplace,
      createdAt: event.createdAt,
      firstItemTitle: event.firstItemTitle,
      extraItemsCount: event.extraItemsCount,
      firstQty: event.firstQty,
      firstUnitPrice: event.firstUnitPrice,
      itemsTotal: event.itemsTotal,
      buyerName: event.buyerName,
      externalId: event.externalId,
      financial: event.financial,
    });

    const req: NotificationRequested = {
      type: 'order.sale', aggregateType: 'order', aggregateId: event.orderId,
      title: 'Nova venda', body,
      severity: 'success',
      channels: ['whatsapp'],
      deduplicationKey: event.triggeredBy === 'manual'
        ? undefined
        : `order.sale:${event.externalId}`,
      source: event.triggeredBy as any,
      data: { externalId: event.externalId, ...event.financial },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  onCancelled(event: OrderCancelledEvent): void {
    const req: NotificationRequested = {
      type: 'order.cancelled', aggregateType: 'order', aggregateId: event.orderId,
      title: `Pedido cancelado - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} cancelado`,
      severity: 'warning',
      deduplicationKey: `order.cancelled:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy as any,
      data: {
        externalId: event.externalId, marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName, totalAmount: event.totalAmount,
        cancelReason: event.cancelReason, cancelledBy: event.cancelledBy,
        stockReverted: event.stockReverted, actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);

    // Notificação WhatsApp de cancelamento só para cancelamentos vindos de webhook.
    if (event.triggeredBy === 'webhook') {
      const waBody = formatCancellationMessage({
        externalId: event.externalId,
        totalAmount: event.totalAmount,
        cancelledBy: event.cancelledBy,
        cancelReason: event.cancelReason,
        stockReverted: event.stockReverted,
      });
      this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
        type: 'order.cancelled.whatsapp', aggregateType: 'order', aggregateId: event.orderId,
        title: 'Pedido cancelado', body: waBody,
        severity: 'warning',
        channels: ['whatsapp'],
        deduplicationKey: `order.cancelled.whatsapp:${event.marketplaceId}:${event.externalId}`,
        source: 'webhook',
        data: { externalId: event.externalId },
      } as NotificationRequested);
    }
  }
}
