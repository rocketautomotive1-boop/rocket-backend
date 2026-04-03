import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PartnerDocument = HydratedDocument<PartnerModel>;

@Schema({ collection: 'partners', timestamps: true })
export class PartnerModel {
  @Prop({ required: true })
  name: string; // "João Silva"

  @Prop({ required: true, unique: true, sparse: true })
  whatsappPhone?: string; // "5511999999999" — número WhatsApp do sócio

  @Prop({ required: true, unique: true, sparse: true })
  email?: string; // Email opcional

  @Prop({ type: [String], default: [] })
  roles: string[]; // ['notifications_sales', 'notifications_alerts']

  @Prop({ default: true })
  active: boolean;

  @Prop()
  lastNotificationAt?: Date; // Último envio de notificação
}

export const PartnerSchema = SchemaFactory.createForClass(PartnerModel);
PartnerSchema.index({ whatsappPhone: 1, active: 1 });
PartnerSchema.index({ roles: 1, active: 1 });
