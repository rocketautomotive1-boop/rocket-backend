import { SetMetadata } from '@nestjs/common';
import { NotificationChannelKey, NotificationView, Recipient } from '../contracts/notification.types';

export const NOTIFICATION_CHANNEL_METADATA = 'notification:channel:key';

export interface NotificationChannel {
  readonly key: NotificationChannelKey;
  readonly retriable: boolean;
  send(notification: NotificationView, recipients: Recipient[]): Promise<void>;
}

export const RegisterNotificationChannel = (key: NotificationChannelKey) =>
  SetMetadata(NOTIFICATION_CHANNEL_METADATA, key);
