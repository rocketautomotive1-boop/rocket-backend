import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpDocument = HydratedDocument<OtpModel>;

export type OtpChannel = 'email' | 'whatsapp' | 'sms';
export type OtpPurpose = 'login' | 'register' | 'verify_email' | 'verify_phone';

/**
 * Código OTP de curta duração para login/verificação sem senha (email magic-code,
 * WhatsApp, SMS fallback). TTL index expira o documento automaticamente — não
 * precisa de job de limpeza.
 */
@Schema({ collection: 'customer_otps', timestamps: true })
export class OtpModel {
    @Prop({ required: true, index: true })
    destination: string; // email ou telefone E.164

    @Prop({ required: true })
    channel: OtpChannel;

    @Prop({ required: true })
    purpose: OtpPurpose;

    @Prop({ required: true })
    codeHash: string; // nunca armazenar o código em texto puro

    @Prop({ default: 0 })
    attempts: number;

    @Prop({ default: false })
    consumed: boolean;

    @Prop({ required: true, index: { expires: 0 } })
    expiresAt: Date;
}

export const OtpSchema = SchemaFactory.createForClass(OtpModel);
OtpSchema.index({ destination: 1, channel: 1, createdAt: -1 });
