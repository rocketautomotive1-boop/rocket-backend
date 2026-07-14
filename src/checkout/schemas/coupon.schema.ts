
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CouponDocument = CouponModel & Document;

@Schema({ timestamps: true })
export class CouponModel {
    @Prop({ required: true, unique: true, uppercase: true, trim: true })
    code: string;

    @Prop({ required: true, enum: ['PERCENTAGE', 'FIXED'] })
    type: string;

    @Prop({ required: true, min: 0 })
    value: number; // Percentage (0-100) or Fixed Amount

    @Prop({ default: 0 })
    minPurchase?: number;

    @Prop()
    expirationDate?: Date;

    @Prop({ default: true })
    isActive: boolean;

    @Prop({ default: null })
    usageLimit?: number;

    @Prop({ default: 0 })
    usedCount: number;

    /** Vazio = todas as categorias elegíveis. Ver docs/superpowers/specs/2026-07-13-offers-system-design.md. */
    @Prop({ type: [String], default: [] })
    categoryIds?: string[];

    /** Vazio = todos os produtos elegíveis. */
    @Prop({ type: [String], default: [] })
    productIds?: string[];

    /** null = sem limite por cliente (só o usageLimit global vale). */
    @Prop({ default: null })
    usageLimitPerCustomer?: number;
}

export const CouponSchema = SchemaFactory.createForClass(CouponModel);
