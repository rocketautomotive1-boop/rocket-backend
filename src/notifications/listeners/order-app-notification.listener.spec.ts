import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { OrderAppNotificationListener } from './order-app-notification.listener';

describe('OrderAppNotificationListener', () => {
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let listener: OrderAppNotificationListener;

  beforeEach(() => {
    eventEmitter = { emit: jest.fn() };
    listener = new OrderAppNotificationListener(eventEmitter as any);
  });

  it('emits a canonical notification request when an order is processed', async () => {
    await listener.handleOrderProcessed({
      orderId: 'order-1',
      externalId: '200001',
      marketplaceId: 'ml',
      marketplaceName: 'Mercado Livre',
      items: [{ productId: 'p1', quantity: 2, unitPrice: 50, sku: 'SKU-1' }],
      totalAmount: 100,
      triggeredBy: 'webhook',
    } as any);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.REQUESTED,
      expect.objectContaining({
        type: 'order.processed',
        aggregateType: 'order',
        aggregateId: 'order-1',
        deduplicationKey: 'order.processed:ml:200001',
        source: 'webhook',
        channels: ['persist', 'push', 'websocket'],
      }),
    );
  });

  it('emits a canonical notification request when an order is cancelled', async () => {
    await listener.handleOrderCancelled({
      orderId: 'order-2',
      externalId: '200002',
      marketplaceId: 'ml',
      marketplaceName: 'Mercado Livre',
      totalAmount: 80,
      cancelReason: 'buyer_cancelled',
      cancelledBy: 'buyer',
      stockReverted: true,
      triggeredBy: 'sync',
    } as any);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.REQUESTED,
      expect.objectContaining({
        type: 'order.cancelled',
        aggregateType: 'order',
        aggregateId: 'order-2',
        deduplicationKey: 'order.cancelled:ml:200002',
        source: 'sync',
        severity: 'warning',
      }),
    );
  });
});
