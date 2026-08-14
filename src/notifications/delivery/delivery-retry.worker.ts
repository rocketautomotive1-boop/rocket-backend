import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Interval } from '@nestjs/schedule';
import { NotificationModel, NotificationDocument } from '../schemas/notification.schema';
import { NotificationChannelRegistry } from '../channels/notification-channel.registry';
import { AudienceResolver } from '../core/audience-resolver.service';
import { DeliveryStatusService } from './delivery-status.service';
import { NotificationView } from '../contracts/notification.types';

const MAX_ATTEMPTS = 5;
const POLL_MS = 30_000;

@Injectable()
export class DeliveryRetryWorker {
  private readonly logger = new Logger(DeliveryRetryWorker.name);

  constructor(
    @InjectModel(NotificationModel.name)
    private readonly model: Model<NotificationDocument>,
    private readonly registry: NotificationChannelRegistry,
    private readonly audience: AudienceResolver,
    private readonly status: DeliveryStatusService,
  ) {}

  @Interval(POLL_MS)
  async tick(): Promise<void> {
    const docs = await this.model.find({
      delivery: {
        $elemMatch: { status: 'failed', nextRetryAt: { $lte: new Date(), $ne: null } },
      },
    }).lean().exec();

    for (const doc of docs as any[]) {
      const view: NotificationView = {
        id: String(doc._id), category: doc.category, type: doc.type,
        title: doc.title, body: doc.body, severity: doc.severity,
        data: doc.data ?? {}, createdAt: doc.createdAt ?? new Date(),
      };
      const recipients = await this.audience.resolve({ kind: 'all-admins' });

      for (const entry of doc.delivery ?? []) {
        if (entry.status !== 'failed') continue;
        if (!entry.nextRetryAt || new Date(entry.nextRetryAt) > new Date()) continue;
        if ((entry.attempts ?? 0) >= MAX_ATTEMPTS) continue;
        const channel = this.registry.get(entry.channel);
        if (!channel || !channel.retriable) continue;

        try {
          await channel.send(view, recipients);
          await this.status.markSent(view.id, entry.channel);
          this.logger.log(`[Retry] ${entry.channel} OK para ${view.id}`);
        } catch (err) {
          await this.status.markFailed(view.id, entry.channel, (err as Error).message, true);
          this.logger.warn(`[Retry] ${entry.channel} falhou de novo para ${view.id}`);
        }
      }
    }
  }
}
