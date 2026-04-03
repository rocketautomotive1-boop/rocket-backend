import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationModel, NotificationDocument } from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';

export interface NotificationSendEvent {
    category: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    channels?: string[];
    severity?: string;
    deduplicationKey?: string;
    targetUserId?: string;
}

@Injectable()
export class NotificationBusService {
    private readonly logger = new Logger(NotificationBusService.name);

    constructor(
        @InjectModel(NotificationModel.name)
        private readonly notificationModel: Model<NotificationDocument>,
        private readonly notificationsService: NotificationsService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    @OnEvent('notification.send', { async: true })
    async handleNotification(event: NotificationSendEvent): Promise<void> {
        try {
            const channels = event.channels || ['push', 'persist'];
            const deduplicationKey = event.deduplicationKey ||
                `${event.category}:${event.data?.marketplace || 'system'}:${event.data?.externalId || Date.now()}`;

            // Deduplication: check for same key in last 5 minutes
            // ML retries webhooks every ~66s, so 60s window is too short
            if (deduplicationKey) {
                const existing = await this.notificationModel.findOne({
                    deduplicationKey,
                    createdAt: { $gte: new Date(Date.now() - 300_000) },
                });
                if (existing) {
                    this.logger.debug(`[Bus] Duplicate notification skipped: ${deduplicationKey}`);
                    return;
                }
            }

            // Persist
            const notification = await this.notificationModel.create({
                category: event.category,
                title: event.title,
                body: event.body,
                data: event.data || {},
                channels,
                severity: event.severity || 'info',
                deduplicationKey,
                targetUserId: event.targetUserId || null,
            });

            this.logger.log(`[Bus] Notification persisted: ${event.category} — ${event.title}`);

            // Route to channels
            if (channels.includes('push')) {
                try {
                    if (event.targetUserId) {
                        await this.notificationsService.sendPushNotificationToUser(
                            event.targetUserId,
                            event.title,
                            event.body,
                            { ...event.data, notificationId: notification._id.toString() },
                        );
                    } else {
                        await this.notificationsService.notifyAllAdmins(
                            event.title,
                            event.body,
                            { ...event.data, notificationId: notification._id.toString() },
                        );
                    }
                    notification.pushSent = true;
                    await notification.save();
                } catch (pushErr) {
                    this.logger.error(`[Bus] Push failed: ${(pushErr as Error).message}`);
                }
            }

            if (channels.includes('websocket')) {
                this.eventEmitter.emit('notification.broadcast', {
                    id: notification._id.toString(),
                    category: notification.category,
                    title: notification.title,
                    body: notification.body,
                    data: notification.data,
                    severity: notification.severity,
                    createdAt: (notification as any).createdAt,
                });
            }

            if (channels.includes('email') && event.data?.email) {
                try {
                    await this.notificationsService.sendEmail(
                        event.data.email,
                        event.title,
                        event.body,
                    );
                    notification.emailSent = true;
                    await notification.save();
                } catch (emailErr) {
                    this.logger.error(`[Bus] Email failed: ${(emailErr as Error).message}`);
                }
            }
        } catch (err) {
            this.logger.error(`[Bus] Error processing notification: ${(err as Error).message}`, (err as Error).stack);
        }
    }

    async findAll(query: {
        page?: number;
        limit?: number;
        category?: string;
        userId?: string;
    }): Promise<{ items: NotificationDocument[]; total: number }> {
        const { page = 1, limit = 50, category, userId } = query;
        const filter: any = {};
        if (category) filter.category = category;

        const [items, total] = await Promise.all([
            this.notificationModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean()
                .exec(),
            this.notificationModel.countDocuments(filter).exec(),
        ]);

        // Enrich with read status if userId provided
        if (userId) {
            items.forEach((item: any) => {
                item.read = (item.readBy || []).some((id: any) => id.toString() === userId);
            });
        }

        return { items: items as any, total };
    }

    async markAsRead(notificationId: string, userId: string): Promise<void> {
        await this.notificationModel.updateOne(
            { _id: notificationId },
            { $addToSet: { readBy: userId } },
        );
    }

    async markAllAsRead(userId: string): Promise<void> {
        await this.notificationModel.updateMany(
            { readBy: { $ne: userId } },
            { $addToSet: { readBy: userId } },
        );
    }

    async getUnreadCount(userId: string): Promise<number> {
        return this.notificationModel.countDocuments({
            readBy: { $ne: userId },
        });
    }
}
