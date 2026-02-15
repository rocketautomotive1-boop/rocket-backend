
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
}

export const CouponSchema = SchemaFactory.createForClass(CouponModel);
