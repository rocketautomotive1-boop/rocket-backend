import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<NotificationModel>;

@Schema({ collection: 'notifications', timestamps: true })
export class NotificationModel {
    @Prop({ required: true, index: true })
    category: string; // 'order' | 'question' | 'stock' | 'system' | 'marketplace'

    @Prop({ required: true })
    title: string;

    @Prop({ required: true })
    body: string;

    @Prop({ type: Object, default: {} })
    data: Record<string, any>;

    @Prop({ type: [String], default: ['push', 'persist'] })
    channels: string[];

    @Prop({ default: 'info' })
    severity: string; // 'info' | 'success' | 'warning' | 'error'

    @Prop({ index: true, sparse: true })
    deduplicationKey: string;

    @Prop({ default: false })
    pushSent: boolean;

    @Prop({ default: false })
    emailSent: boolean;

    @Prop({ type: [{ type: Types.ObjectId, ref: 'UserModel' }], default: [] })
    readBy: Types.ObjectId[];

    @Prop({ type: Types.ObjectId, ref: 'UserModel', default: null })
    targetUserId: Types.ObjectId;
}

export const NotificationSchema = SchemaFactory.createForClass(NotificationModel);
