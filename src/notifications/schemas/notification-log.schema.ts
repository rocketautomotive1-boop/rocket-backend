import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationLogDocument = HydratedDocument<NotificationLogModel>;

@Schema({ collection: 'notification_logs', timestamps: true })
export class NotificationLogModel {
  @Prop({ required: true })
  jobId: string; // UUID unique para rastreamento

  @Prop({ required: true })
  type: string; // 'whatsapp', 'email', 'sms'

  @Prop({ required: true })
  destination: string; // Número WhatsApp, email, etc

  @Prop()
  orderId?: string; // Link para order (se aplicável)

  @Prop()
  externalOrderId?: string; // ML-123456, etc

  @Prop()
  content: string; // Conteúdo da mensagem

  @Prop({ type: Object })
  metadata?: Record<string, any>; // grossProfit, netProfit, etc

  // Status lifecycle
  @Prop({ default: 'pending', index: true })
  status: string; // 'pending', 'queued', 'delivered', 'failed', 'expired'

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  lastAttemptAt?: Date;

  @Prop()
  deliveredAt?: Date;

  @Prop()
  error?: string; // Mensagem de erro (se falhou)

  // Retry info
  @Prop()
  nextRetryAt?: Date;

  @Prop()
  expireAt?: Date; // TTL index para auto-limpeza

  @Prop({ default: true })
  active: boolean;
}

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLogModel);
NotificationLogSchema.index({ jobId: 1 }, { unique: true });
NotificationLogSchema.index({ status: 1, createdAt: -1 });
NotificationLogSchema.index({ externalOrderId: 1 });
NotificationLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
