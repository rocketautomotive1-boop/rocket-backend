import { Injectable } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderProcessedEvent, OrderCancelledEvent } from '../../order/events/order.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationRequested } from '../contracts/notification-requested.event';

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
  }
}
