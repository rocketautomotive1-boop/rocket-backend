import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { RegisterNotificationChannel, NotificationChannel } from './notification-channel.interface';
import { NotificationView, Recipient } from '../contracts/notification.types';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

@Injectable()
@RegisterNotificationChannel('push')
export class PushChannel implements NotificationChannel {
  readonly key = 'push' as const;
  readonly retriable = true;
  private readonly logger = new Logger(PushChannel.name);

  async send(notification: NotificationView, recipients: Recipient[]): Promise<void> {
    const tokens = recipients.flatMap((r) => r.pushTokens).filter(Boolean);
    const unique = [...new Set(tokens)];
    if (unique.length === 0) return;

    const messages = unique.map((to) => ({
      to, title: notification.title, body: notification.body,
      channelId: 'rocket_updates', priority: 'high' as const, sound: 'default' as const,
      data: { ...notification.data, notificationId: notification.id },
    }));

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const res = await axios.post(EXPO_PUSH_URL, batch, {
        headers: { 'Content-Type': 'application/json' },
      });
      this.logger.log(`[Push] batch ${batch.length} enviado — status ${res.status}`);
    }
  }
}
