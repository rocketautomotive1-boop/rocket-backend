import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationModel, NotificationDocument } from '../schemas/notification.schema';

const DEDUP_WINDOW_MS = 300_000; // 5min — ML reenvia webhooks a cada ~66s

@Injectable()
export class NotificationDedupService {
  constructor(
    @InjectModel(NotificationModel.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async isDuplicate(deduplicationKey: string): Promise<boolean> {
    const existing = await this.notificationModel
      .findOne({
        deduplicationKey,
        createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      })
      .lean()
      .exec();
    return !!existing;
  }
}
