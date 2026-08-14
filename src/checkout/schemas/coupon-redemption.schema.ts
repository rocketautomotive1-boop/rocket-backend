import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CouponRedemptionDocument = CouponRedemptionModel & Document;

/**
 * Registro de uso CONFIRMADO de um cupom (associado a um pedido pago) — nunca gravado na
 * aplicação ao carrinho, só no checkout bem-sucedido. Base para usageLimitPerCustomer. Ver
 * docs/superpowers/specs/2026-07-13-offers-system-design.md.
 */
@Schema({ timestamps: true })
export class CouponRedemptionModel {
    @Prop({ type: Types.ObjectId, required: true, index: true })
    couponId: Types.ObjectId;

    @Prop({ required: true, index: true })
    customerId: string;

    @Prop({ required: true })
    orderId: string;
}

export const CouponRedemptionSchema = SchemaFactory.createForClass(CouponRedemptionModel);

CouponRedemptionSchema.index({ couponId: 1, customerId: 1, orderId: 1 }, { unique: true });
