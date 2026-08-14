import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RegisterNotificationChannel, NotificationChannel } from './notification-channel.interface';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationView, Recipient } from '../contracts/notification.types';

@Injectable()
@RegisterNotificationChannel('websocket')
export class WebsocketChannel implements NotificationChannel {
  readonly key = 'websocket' as const;
  readonly retriable = false;

  constructor(private readonly emitter: EventEmitter2) {}

  async send(notification: NotificationView, recipients: Recipient[]): Promise<void> {
    this.emitter.emit(NOTIFICATION_EVENTS.BROADCAST, {
      id: notification.id,
      category: notification.category,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      severity: notification.severity,
      createdAt: notification.createdAt,
      userIds: recipients.map((r) => r.userId),
    });
  }
}
