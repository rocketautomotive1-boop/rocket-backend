import { Injectable } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  ORDER_EVENTS,
  OrderCancelledEvent,
  OrderProcessedEvent,
} from '../../order/events/order.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';

@Injectable()
export class OrderAppNotificationListener {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent(ORDER_EVENTS.PROCESSED, { async: true })
  async handleOrderProcessed(event: OrderProcessedEvent): Promise<void> {
    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'order.processed',
      aggregateType: 'order',
      aggregateId: event.orderId,
      title: `Nova venda - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} recebido`,
      channels: ['persist', 'push', 'websocket'],
      severity: 'success',
      deduplicationKey: `order.processed:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy,
      data: {
        externalId: event.externalId,
        marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName,
        totalAmount: event.totalAmount,
        itemCount: event.items?.length || 0,
        actionRoute: '/(drawer)/orders',
      },
    });
  }

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  async handleOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'order.cancelled',
      aggregateType: 'order',
      aggregateId: event.orderId,
      title: `Pedido cancelado - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} cancelado`,
      channels: ['persist', 'push', 'websocket'],
      severity: 'warning',
      deduplicationKey: `order.cancelled:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy,
      data: {
        externalId: event.externalId,
        marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName,
        totalAmount: event.totalAmount,
        cancelReason: event.cancelReason,
        cancelledBy: event.cancelledBy,
        stockReverted: event.stockReverted,
        actionRoute: '/(drawer)/orders',
      },
    });
  }
}
