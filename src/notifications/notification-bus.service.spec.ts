import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationBusService } from './notification-bus.service';
import { NOTIFICATION_EVENTS } from './events/notification.events';

describe('NotificationBusService', () => {
  const notificationDoc = {
    _id: { toString: () => 'notification-1' },
    category: 'order',
    title: 'Nova venda - Mercado Livre',
    body: 'Pedido 200001 recebido',
    data: {},
    severity: 'success',
    pushSent: false,
    emailSent: false,
    save: jest.fn().mockResolvedValue(undefined),
  };

  let notificationModel: any;
  let notificationsService: any;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let service: NotificationBusService;

  beforeEach(() => {
    notificationDoc.save.mockClear();

    notificationModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(notificationDoc),
    };
    notificationsService = {
      notifyAllAdmins: jest.fn().mockResolvedValue(undefined),
      sendPushNotificationToUser: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = { emit: jest.fn() };

    service = new NotificationBusService(
      notificationModel,
      notificationsService,
      eventEmitter as any,
    );
  });

  it('maps notification.requested into persistence, push and websocket delivery', async () => {
    await service.handleNotificationRequested({
      type: 'order.processed',
      aggregateType: 'order',
      aggregateId: 'order-1',
      title: 'Nova venda - Mercado Livre',
      body: 'Pedido 200001 recebido',
      channels: ['persist', 'push', 'websocket'],
      severity: 'success',
      source: 'webhook',
      data: {
        externalId: '200001',
        marketplace: 'mercadolivre',
      },
    });

    expect(notificationModel.findOne).toHaveBeenCalledWith({
      deduplicationKey: 'order.processed:order:order-1',
      createdAt: expect.any(Object),
    });
    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'order',
        title: 'Nova venda - Mercado Livre',
        body: 'Pedido 200001 recebido',
        channels: ['persist', 'push', 'websocket'],
        severity: 'success',
        deduplicationKey: 'order.processed:order:order-1',
        targetUserId: null,
      }),
    );
    expect(notificationModel.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        type: 'order.processed',
        aggregateType: 'order',
        aggregateId: 'order-1',
        source: 'webhook',
        externalId: '200001',
      }),
    );
    expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
      'Nova venda - Mercado Livre',
      'Pedido 200001 recebido',
      expect.objectContaining({ notificationId: 'notification-1' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      NOTIFICATION_EVENTS.BROADCAST,
      expect.objectContaining({
        id: 'notification-1',
        category: 'order',
      }),
    );
  });

  it('skips duplicate canonical requests', async () => {
    notificationModel.findOne.mockResolvedValueOnce({ _id: 'existing' });

    await service.handleNotificationRequested({
      type: 'question.received',
      aggregateType: 'question',
      aggregateId: 'question-1',
      title: 'Nova Pergunta!',
      body: 'Pergunta recebida',
    });

    expect(notificationModel.create).not.toHaveBeenCalled();
    expect(notificationsService.notifyAllAdmins).not.toHaveBeenCalled();
  });
});
