import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationModel, NotificationDocument } from '../schemas/notification.schema';

@Injectable()
export class NotificationReadService {
  constructor(
    @InjectModel(NotificationModel.name)
    private readonly model: Model<NotificationDocument>,
  ) {}

  async findAll(query: { page?: number; limit?: number; category?: string; userId?: string }) {
    const { page = 1, limit = 50, category, userId } = query;
    const filter: any = {};
    if (category) filter.category = category;

    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    if (userId) {
      items.forEach((item: any) => {
        item.read = (item.readBy || []).some((id: any) => id.toString() === userId);
      });
    }
    return { items, total };
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.model.updateOne({ _id: notificationId }, { $addToSet: { readBy: userId } });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.model.updateMany({ readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.model.countDocuments({ readBy: { $ne: userId } });
  }
}
