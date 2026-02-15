import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type QueueRecordDocument = QueueRecordModel & Document;

@Schema({ collection: 'queue_records', timestamps: true })
export class QueueRecordModel {
    _id: Types.ObjectId;

    @Prop({ required: true })
    type: string;

    @Prop({ default: 'pending', index: true })
    status: string; // pending, processing, completed, failed

    @Prop({ required: false })
    productId: string;

    @Prop({ required: false, index: true })
    attemptId: string;

    @Prop({ type: {}, required: false })
    marketplaceId: number | string | any;


    @Prop({ type: Object, default: {} })
    metadata: Record<string, any>;

    @Prop({ type: Object, default: {} })
    result: Record<string, any>;

    @Prop({ type: String })
    error: string;

    @Prop({ default: 0 })
    priority: number;

    @Prop({ default: 0 })
    attempts: number;

    @Prop({ default: 3 })
    maxAttempts: number;

    @Prop()
    startedAt: Date;

    @Prop()
    completedAt: Date;

    @Prop({ expires: 604800 }) // 7 days in seconds
    createdAt?: Date;

    updatedAt?: Date;
}

export const QueueRecordSchema = SchemaFactory.createForClass(QueueRecordModel);
