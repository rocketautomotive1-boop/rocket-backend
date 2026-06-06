import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type WebhookInboxDocument = HydratedDocument<WebhookInboxModel>;
export type WebhookInboxStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead';
export type WebhookInboxKind = 'order' | 'order_pack' | 'question' | 'unparseable';
@Schema({ collection: 'webhook_inbox', timestamps: true })
export class WebhookInboxModel {
  @Prop({ required: true, index: true }) marketplace: string;
  @Prop({ required: true }) topic: string;
  @Prop({ required: true }) kind: WebhookInboxKind;
  @Prop({ required: true, unique: true }) eventId: string;
  @Prop({ index: true }) externalId?: string;
  @Prop() resource?: string;
  @Prop({ type: Object, required: true }) payload: any;
  @Prop({ default: 'pending', index: true }) status: WebhookInboxStatus;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 8 }) maxAttempts: number;
  @Prop() owner?: string;
  @Prop({ index: true }) leaseUntil?: Date;
  @Prop({ index: true }) nextRetryAt?: Date;
  @Prop() receivedAt?: Date;
  @Prop() processedAt?: Date;
  @Prop() processingAt?: Date;
  @Prop() lastError?: string;
}
export const WebhookInboxSchema = SchemaFactory.createForClass(WebhookInboxModel);
WebhookInboxSchema.index({ status: 1, leaseUntil: 1, nextRetryAt: 1, createdAt: 1 });
