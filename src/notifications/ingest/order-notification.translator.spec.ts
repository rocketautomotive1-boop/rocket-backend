import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderNotificationTranslator } from './order-notification.translator';
import { NOTIFICATION_EVENTS } from '../events/notification.events';

describe('OrderNotificationTranslator', () => {
  it('PROCESSED → NotificationRequested canônico de venda', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onProcessed({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      totalAmount: 100, items: [{}], triggeredBy: 'webhook',
    } as any);
    expect(spy).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      type: 'order.processed', aggregateType: 'order', aggregateId: 'o1',
      deduplicationKey: 'order.processed:m1:EXT', severity: 'success',
    }));
  });

  it('CANCELLED → NotificationRequested canônico de cancelamento', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onCancelled({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      totalAmount: 100, cancelReason: 'x', cancelledBy: 'buyer', stockReverted: true,
      triggeredBy: 'webhook',
    } as any);
    expect(spy).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      type: 'order.cancelled', aggregateType: 'order', severity: 'warning',
    }));
  });

  // Helper: encontra a NotificationRequested de canal WhatsApp entre as emissões.
  const whatsappCall = (spy: jest.SpyInstance) =>
    spy.mock.calls.find(
      ([evt, req]: any[]) =>
        evt === NOTIFICATION_EVENTS.REQUESTED && req?.channels?.includes('whatsapp'),
    );

  it('dispara WhatsApp de cancelamento quando detectado pelo RECONCILER', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onCancelled({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      totalAmount: 100, cancelReason: 'x', cancelledBy: 'buyer', stockReverted: true,
      triggeredBy: 'reconcile',
    } as any);
    expect(whatsappCall(spy)).toBeDefined();
  });

  it('NÃO dispara WhatsApp de cancelamento em fix em massa (sync)', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onCancelled({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      totalAmount: 100, cancelReason: 'x', cancelledBy: 'buyer', stockReverted: true,
      triggeredBy: 'sync',
    } as any);
    expect(whatsappCall(spy)).toBeUndefined();
  });
});
