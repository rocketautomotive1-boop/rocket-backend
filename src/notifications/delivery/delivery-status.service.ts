import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationModel, NotificationDocument } from '../schemas/notification.schema';

const BACKOFF_MS = [30_000, 60_000, 120_000];
const MAX_BACKOFF_MS = 1_800_000; // 30min

@Injectable()
export class DeliveryStatusService {
  constructor(
    @InjectModel(NotificationModel.name)
    private readonly model: Model<NotificationDocument>,
  ) {}

  async markSent(notificationId: string, channel: string): Promise<void> {
    await this.model.updateOne(
      { _id: notificationId, 'delivery.channel': channel },
      {
        $set: {
          'delivery.$.status': 'sent',
          'delivery.$.lastAttemptAt': new Date(),
          'delivery.$.lastError': null,
          'delivery.$.nextRetryAt': null,
        },
        $inc: { 'delivery.$.attempts': 1 },
      },
    );
  }

  async markFailed(
    notificationId: string, channel: string, error: string, retriable: boolean,
  ): Promise<void> {
    const doc = await this.model.findOne(
      { _id: notificationId }, { delivery: 1 },
    ).lean().exec();
    const entry = (doc?.delivery ?? []).find((d: any) => d.channel === channel);
    const attempts = (entry?.attempts ?? 0) + 1;
    const backoff = Math.min(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)], MAX_BACKOFF_MS);
    await this.model.updateOne(
      { _id: notificationId, 'delivery.channel': channel },
      {
        $set: {
          'delivery.$.status': 'failed',
          'delivery.$.lastError': error,
          'delivery.$.lastAttemptAt': new Date(),
          'delivery.$.nextRetryAt': retriable ? new Date(Date.now() + backoff) : null,
        },
        $inc: { 'delivery.$.attempts': 1 },
      },
    );
  }
}
