import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WebhookInboxDocument = HydratedDocument<WebhookInboxModel>;

export type WebhookInboxStatus = 'pending' | 'processing' | 'done' | 'failed';

@Schema({ collection: 'webhook_inbox', timestamps: true })
export class WebhookInboxModel {
  @Prop({ required: true, index: true })
  marketplace: string;

  @Prop({ required: true, index: true })
  topic: string;

  @Prop({ type: Object, required: true })
  payload: any;

  @Prop({ required: true, unique: true })
  dedupeKey: string;

  @Prop({ default: 'pending', index: true })
  status: WebhookInboxStatus;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: 8 })
  maxAttempts: number;

  @Prop({ index: true })
  nextRetryAt?: Date;

  @Prop()
  processedAt?: Date;

  @Prop()
  processingAt?: Date;

  @Prop()
  lastError?: string;
}

export const WebhookInboxSchema = SchemaFactory.createForClass(WebhookInboxModel);

WebhookInboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });
