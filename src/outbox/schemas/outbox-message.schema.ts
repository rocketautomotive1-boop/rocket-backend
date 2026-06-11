import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OutboxMessageDocument = HydratedDocument<OutboxMessage>;
export type OutboxStatus = 'pending' | 'publishing' | 'published' | 'failed';

@Schema({ collection: 'outbox_messages', timestamps: true })
export class OutboxMessage {
  _id: Types.ObjectId;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  routingKey: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({
    type: String,
    enum: ['pending', 'publishing', 'published', 'failed'],
    default: 'pending',
  })
  status: OutboxStatus;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: 8 })
  maxAttempts: number;

  @Prop({ type: Date, default: () => new Date() })
  scheduledAt: Date;

  @Prop({ type: String, default: null })
  claimId: string | null;

  @Prop({ type: Date, default: null })
  processingStartedAt: Date | null;

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: String, default: null })
  lastError: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const OutboxMessageSchema = SchemaFactory.createForClass(OutboxMessage);

// Claim do relay
OutboxMessageSchema.index({ status: 1, scheduledAt: 1 });
// Recovery de publishing stale
OutboxMessageSchema.index({ status: 1, processingStartedAt: 1 });
// Retenção: arquiva published após OUTBOX_RETENTION_SECONDS (default 7d)
OutboxMessageSchema.index(
  { publishedAt: 1 },
  {
    expireAfterSeconds: Number(process.env.OUTBOX_RETENTION_SECONDS) || 604800,
    partialFilterExpression: { status: 'published' },
  },
);
