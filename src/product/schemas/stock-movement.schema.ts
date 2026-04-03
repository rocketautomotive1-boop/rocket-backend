import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductModel } from './product.schema';

export type StockMovementDocument = HydratedDocument<StockMovementModel>;

@Schema({ collection: 'stock_movements', timestamps: true })
export class StockMovementModel {
    id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: ProductModel; // Renamed from product

    @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
    orderId: any;

    @Prop({ required: true })
    type: string; // inbound, outbound, transfer, adjustment

    @Prop({ required: true })
    quantity: number;

    @Prop({ required: true })
    date: Date;

    @Prop({ type: Types.Decimal128 })
    price: Types.Decimal128; // Sales Price

    @Prop({ type: Types.Decimal128 })
    costPrice: Types.Decimal128; // Cost Snapshot

    @Prop()
    reason: string;

    @Prop({ type: Object })
    origin: {
        type: string; // 'warehouse', 'marketplace'
        location: string; // 'Corredor A', 'MLB', 'SHO'
    };

    /** Condição comercial do lote: novo / usado / recondicionado (alinhado ao estoque, não ao cadastro do produto). */
    @Prop({ default: 'new' })
    condition: string;

    @Prop({ default: 'normal' })
    situation: string;

    @Prop()
    observation: string;

    @Prop({ type: Object })
    metadata: {
        operator?: string;
        externalReference?: string;
    };

    @Prop({ type: Types.ObjectId, ref: 'AllocationModel', index: true })
    fromAllocationId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'AllocationModel', index: true })
    toAllocationId?: Types.ObjectId;
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovementModel);

// Compound index for fast history retrieval
StockMovementSchema.index({ productId: 1, date: -1 });

// Idempotency check via metadata.externalReference
StockMovementSchema.index({ 'metadata.externalReference': 1, productId: 1, type: 1 }, { unique: true, sparse: true });
