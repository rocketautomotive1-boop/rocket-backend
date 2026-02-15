
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CartDocument = CartModel & Document;

@Schema()
export class CartItemSnapshot {
    @Prop({ required: true })
    productId: string;

    @Prop({ required: true })
    quantity: number;

    @Prop({ required: true, type: Types.Decimal128, default: 0 })
    unitPrice: Types.Decimal128;

    @Prop()
    variantId?: number; // Optional reference, if needed
}

export const CartItemSchema = SchemaFactory.createForClass(CartItemSnapshot);


@Schema({ timestamps: true })
export class CartModel {
    @Prop()
    customerId?: number; // Keeping primitive number for legacy ID compatibility

    @Prop()
    sessionId?: string;

    @Prop({ default: 'active' })
    status: string;

    @Prop({ type: [CartItemSchema], default: [] })
    items: CartItemSnapshot[];

    @Prop()
    createdAt?: Date;

    @Prop()
    updatedAt?: Date;

    @Prop()
    couponCode?: string;

    @Prop({ type: Number, default: 0 })
    discountAmount: number;
}

export const CartSchema = SchemaFactory.createForClass(CartModel);
