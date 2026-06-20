import { Inject, Injectable } from '@nestjs/common';
import { RegisterNotificationChannel, NotificationChannel } from './notification-channel.interface';
import { NotificationView, Recipient } from '../contracts/notification.types';
import { WHATSAPP_PORT, WhatsAppPort } from '../../whatsapp/whatsapp.port';

/**
 * Canal WhatsApp do pipeline. Fino: enfileira o body já formatado via WHATSAPP_PORT.
 * O destino default (grupo) é resolvido pelo transporte. Retry/DLQ ficam no transporte.
 */
@Injectable()
@RegisterNotificationChannel('whatsapp')
export class WhatsappChannel implements NotificationChannel {
  readonly key = 'whatsapp' as const;
  readonly retriable = false; // retry coberto pelo transporte (queue worker + DLQ)

  constructor(@Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort) {}

  async send(notification: NotificationView, _recipients: Recipient[]): Promise<void> {
    await this.whatsapp.enqueue({
      content: notification.body,
      correlationId: notification.data?.externalId ?? notification.id,
      metadata: notification.data,
    });
  }
}
