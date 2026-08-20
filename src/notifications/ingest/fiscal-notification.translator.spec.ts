import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalNotificationTranslator } from './fiscal-notification.translator';
import { FiscalNfeAuthorizedEvent, FiscalNfeIssuanceStuckEvent } from '../../fiscal/events/fiscal.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';

describe('FiscalNotificationTranslator', () => {
  let translator: FiscalNotificationTranslator;
  let emitter: EventEmitter2;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [FiscalNotificationTranslator, EventEmitter2],
    }).compile();

    translator = moduleRef.get(FiscalNotificationTranslator);
    emitter = moduleRef.get(EventEmitter2);
  });

  it('onAuthorized emite NotificationRequested com deduplicationKey estável por accessKey', () => {
    const listener = jest.fn();
    emitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    const event = new FiscalNfeAuthorizedEvent('nfe-1', 'order-1', 'store-1', 'CHAVE123', 1, 42, '<xml/>');
    translator.onAuthorized(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'fiscal.nfe.authorized',
      aggregateType: 'fiscal',
      aggregateId: 'order-1',
      deduplicationKey: 'fiscal.nfe.authorized:CHAVE123',
      severity: 'success',
    });
  });

  it('onIssuanceStuck emite notificação de erro para admins', () => {
    const listener = jest.fn();
    emitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    const event = new FiscalNfeIssuanceStuckEvent('order-1', 5, 'ETIMEDOUT');
    translator.onIssuanceStuck(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'fiscal.nfe.issuance.stuck',
      severity: 'error',
      audience: { kind: 'all-admins' },
    });
  });
});
