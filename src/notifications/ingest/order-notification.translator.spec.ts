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

  it('SHIPPING_UPDATED (delivered) → NotificationRequested só sino/app (sem whatsapp)', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onShippingUpdated({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      substatus: 'delivered', trackingCode: 'TRK1', triggeredBy: 'webhook',
    } as any);
    const [, req] = spy.mock.calls.find(([evt]: any[]) => evt === NOTIFICATION_EVENTS.REQUESTED)!;
    expect(req).toEqual(expect.objectContaining({
      type: 'order.shipping', aggregateType: 'order', aggregateId: 'o1',
      title: 'Pedido entregue', severity: 'info',
      deduplicationKey: 'order.shipping:EXT:delivered',
    }));
    expect((req as any).channels).toBeUndefined(); // nunca WhatsApp
  });

  it('SHIPPING_UPDATED (not_delivered) → severidade warning', () => {
    const emitter = new EventEmitter2();
    const spy = jest.spyOn(emitter, 'emit');
    new OrderNotificationTranslator(emitter).onShippingUpdated({
      orderId: 'o1', externalId: 'EXT', marketplaceId: 'm1', marketplaceName: 'ML',
      substatus: 'not_delivered', trackingCode: null, triggeredBy: 'webhook',
    } as any);
    const [, req] = spy.mock.calls.find(([evt]: any[]) => evt === NOTIFICATION_EVENTS.REQUESTED)!;
    expect(req).toEqual(expect.objectContaining({ severity: 'warning', title: 'Falha na entrega' }));
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
