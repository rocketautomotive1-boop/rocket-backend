import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { UserModel, UserDocument } from '../auth/schemas/user.schema';
import { EmailService } from './email.service';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectModel(UserModel.name) private readonly userModel: Model<UserDocument>,
        private readonly emailService: EmailService,
    ) { }

    async registerToken(userId: string, token: string) {
        this.logger.log(`Registering token for user ${userId}: ${token}`);

        if (!userId || !token || userId === 'NaN' || !isValidObjectId(userId)) {
            this.logger.warn(`Invalid userId or token: ${userId}`);
            return false;
        }

        const user = await this.userModel.findById(userId).exec();

        if (!user) {
            this.logger.warn(`User ${userId} not found`);
            return false;
        }

        const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
        if (!tokens.includes(token)) {
            user.pushTokens = [token, ...tokens].slice(0, 10);
            await user.save();
            this.logger.log(`Token saved for user ${userId}`);
        } else {
            this.logger.log(`Token already exists for user ${userId}`);
        }
        return true;
    }

    async sendPushNotificationToUser(userId: string, title: string, body: string, data?: any) {
        const user = await this.userModel.findById(userId).exec();

        if (!user || !user.pushTokens || user.pushTokens.length === 0) {
            this.logger.warn(`No push tokens for user ${userId}`);
            return;
        }

        // Send to all tokens
        for (const token of user.pushTokens) {
            await this.sendPush(token, title, body, data);
        }
    }

    async sendPush(token: string, title: string, body: string, data?: any) {
        this.logger.log(`Sending push to ${token}: ${title}`);
        try {
            const message = {
                to: token,
                title: title,
                body: body,
                channelId: 'rocket_updates',
                priority: 'high',
                sound: 'default',
                data: data || {},
            };
            const response = await axios.post('https://exp.host/--/api/v2/push/send', message, {
                headers: { 'Content-Type': 'application/json' },
            });
            this.logger.log(`[Push] Sent to ${token}. Expo Status: ${response.status}`);
        } catch (error) {
            this.logger.error(`Error sending push to ${token}: ${error.message}`);
        }
    }

    async sendEmail(to: string, subject: string, html: string) {
        return this.emailService.sendEmail(to, subject, html);
    }

    async notifyAllAdmins(title: string, body: string, data?: any) {
        // Ideally we have roles. For now, notify all users with tokens? Or just the first one?
        // Let's notify all users for now as it's a small app.
        const users = await this.userModel.find().exec();

        for (const user of users) {
            if (user.pushTokens && user.pushTokens.length > 0) {
                for (const token of user.pushTokens) {
                    await this.sendPush(token, title, body, data);
                }
            }
        }
    }
}
