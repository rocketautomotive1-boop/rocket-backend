import { Injectable } from '@nestjs/common';
import { RegisterNotificationChannel, NotificationChannel } from './notification-channel.interface';
import { EmailService } from '../email.service';
import { NotificationView, Recipient } from '../contracts/notification.types';

@Injectable()
@RegisterNotificationChannel('email')
export class EmailChannel implements NotificationChannel {
  readonly key = 'email' as const;
  readonly retriable = true;

  constructor(private readonly emailService: EmailService) {}

  async send(notification: NotificationView, recipients: Recipient[]): Promise<void> {
    const targets = recipients.filter((r) => !!r.email);
    for (const r of targets) {
      await this.emailService.sendEmail(r.email!, notification.title, notification.body);
    }
  }
}
