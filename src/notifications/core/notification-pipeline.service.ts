import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationModel, NotificationDocument } from '../schemas/notification.schema';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationRequested } from '../contracts/notification-requested.event';
import { NotificationView, Recipient } from '../contracts/notification.types';
import { applyNotificationDefaults } from './notification-policy';
import { NotificationDedupService } from './notification-dedup.service';
import { AudienceResolver } from './audience-resolver.service';
import { NotificationChannelRegistry } from '../channels/notification-channel.registry';
import { DeliveryStatusService } from '../delivery/delivery-status.service';

@Injectable()
export class NotificationPipelineService {
  private readonly logger = new Logger(NotificationPipelineService.name);

  constructor(
    @InjectModel(NotificationModel.name)
    private readonly model: Model<NotificationDocument>,
    private readonly dedup: NotificationDedupService,
    private readonly audience: AudienceResolver,
    private readonly registry: NotificationChannelRegistry,
    private readonly status: DeliveryStatusService,
  ) {}

  @OnEvent(NOTIFICATION_EVENTS.REQUESTED, { async: true })
  async handle(raw: NotificationRequested): Promise<void> {
    try {
      const req = applyNotificationDefaults(raw);

      if (await this.dedup.isDuplicate(req.deduplicationKey)) {
        this.logger.debug(`[Pipeline] duplicata ignorada: ${req.deduplicationKey}`);
        return;
      }

      const recipients = await this.audience.resolve(req.audience);
      const dispatchChannels = req.channels.filter((c) => c !== 'persist');

      const doc = await this.model.create({
        category: req.aggregateType,
        type: req.type,
        title: req.title,
        body: req.body,
        data: req.data ?? {},
        channels: req.channels,
        severity: req.severity,
        deduplicationKey: req.deduplicationKey,
        audienceUserIds: recipients.map((r) => r.userId) as any,
        delivery: dispatchChannels.map((channel) => ({
          channel, status: 'pending', attempts: 0,
          lastError: null, lastAttemptAt: null, nextRetryAt: null,
        })),
      } as any) as NotificationDocument;

      const view: NotificationView = {
        id: String(doc._id),
        category: req.aggregateType,
        type: req.type,
        title: req.title,
        body: req.body,
        severity: req.severity,
        data: req.data ?? {},
        createdAt: (doc as any).createdAt ?? new Date(),
      };

      await this.fanOut(view, dispatchChannels, recipients);
    } catch (err) {
      this.logger.error(
        `[Pipeline] erro processando notificação: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async fanOut(
    view: NotificationView, channels: string[], recipients: Recipient[],
  ): Promise<void> {
    for (const key of channels) {
      const channel = this.registry.get(key as any);
      if (!channel) {
        this.logger.warn(`[Pipeline] canal desconhecido ignorado: ${key}`);
        continue;
      }
      try {
        await channel.send(view, recipients);
        await this.status.markSent(view.id, key);
      } catch (err) {
        this.logger.error(`[Pipeline] canal ${key} falhou: ${(err as Error).message}`);
        await this.status.markFailed(view.id, key, (err as Error).message, channel.retriable);
      }
    }
  }
}
