import { Injectable } from '@nestjs/common';
import { RegisterNotificationChannel, NotificationChannel } from './notification-channel.interface';
import { WhatsAppNotificationService } from '../services/whatsapp-notification.service';
import { NotificationView, Recipient } from '../contracts/notification.types';

@Injectable()
@RegisterNotificationChannel('whatsapp')
export class WhatsappChannel implements NotificationChannel {
  readonly key = 'whatsapp' as const;
  readonly retriable = false; // retry coberto pelo subsistema WhatsApp (queue worker + reconciler)

  constructor(private readonly whatsapp: WhatsAppNotificationService) {}

  async send(notification: NotificationView, _recipients: Recipient[]): Promise<void> {
    await this.whatsapp.sendSystemMessage(notification.title, notification.body);
  }
}
