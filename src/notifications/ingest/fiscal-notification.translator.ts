import { Injectable } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  FISCAL_EVENTS,
  FiscalNfeAuthorizedEvent,
  FiscalNfeIssuanceStuckEvent,
} from '../../fiscal/events/fiscal.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationRequested } from '../contracts/notification-requested.event';

/**
 * Ponte fiscal → notifications. Importa SOMENTE os tipos de evento de fiscal (não o
 * FiscalModule), mesmo padrão de OrderNotificationTranslator.
 */
@Injectable()
export class FiscalNotificationTranslator {
  constructor(private readonly emitter: EventEmitter2) {}

  @OnEvent(FISCAL_EVENTS.NFE_AUTHORIZED, { async: true })
  onAuthorized(event: FiscalNfeAuthorizedEvent): void {
    const req: NotificationRequested = {
      type: 'fiscal.nfe.authorized',
      aggregateType: 'fiscal',
      aggregateId: event.orderId ?? event.nfeId,
      title: 'NFe emitida',
      body: `NFe ${event.series}/${event.number} autorizada.`,
      severity: 'success',
      deduplicationKey: `fiscal.nfe.authorized:${event.accessKey}`,
      data: {
        nfeId: event.nfeId,
        accessKey: event.accessKey,
        series: event.series,
        number: event.number,
        actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }

  @OnEvent(FISCAL_EVENTS.NFE_ISSUANCE_STUCK, { async: true })
  onIssuanceStuck(event: FiscalNfeIssuanceStuckEvent): void {
    const req: NotificationRequested = {
      type: 'fiscal.nfe.issuance.stuck',
      aggregateType: 'fiscal',
      aggregateId: event.orderId,
      title: 'Emissão de NFe travada',
      body: `Falhou ${event.attempts}x: ${event.lastError}. Intervenção manual necessária.`,
      severity: 'error',
      deduplicationKey: `fiscal.nfe.issuance.stuck:${event.orderId}`,
      audience: { kind: 'all-admins' },
      data: { orderId: event.orderId, attempts: event.attempts, lastError: event.lastError },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }
}
