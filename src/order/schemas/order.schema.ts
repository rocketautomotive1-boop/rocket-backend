import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderDocument = HydratedDocument<OrderModel>;

@Schema()
class OrderItemSnapshot {
    @Prop() externalId?: string; // Marketplace Item ID / Line Item ID
    @Prop() title: string;
    @Prop() quantity: number;
    @Prop() unitPrice: number;

    @Prop() costPriceAtSale?: number; // Snapshot of cost at time of sync

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', default: null })
    productId?: Types.ObjectId; // The single source of truth for Product Link
}

@Schema()
class OrderLogSnapshot {
    @Prop() logType: string; // Renamed from type
    @Prop() message: string;
    @Prop({ type: Object }) details: any;
    @Prop() createdAt: Date;
}

@Schema()
class OrderCustomerSnapshot {
    @Prop() name: string;
    @Prop() document: string;
    @Prop() email: string;
    @Prop() phone: string;

    @Prop({ type: Object })
    address: {
        zipCode: string;
        street: string;
        number: string;
        neighborhood: string;
        city: string;
        state: string;
    };
}

@Schema()
class OrderPaymentSnapshot {
    @Prop() methodId: string;
    @Prop() paymentType: string; // Renamed from type
    @Prop() authorizationCode: string; // from MySQL 'authorizationCode'
}

@Schema({ collection: 'orders', timestamps: true })
export class OrderModel {
    @Prop({ required: true, unique: true })
    externalId: string; // "MLB-12345"

    @Prop({ type: Types.ObjectId, required: true })
    marketplaceId: Types.ObjectId;

    @Prop({ required: true, index: true })
    status: string;

    @Prop({ required: true, default: 0 })
    totalAmount: number;

    @Prop({ required: true, default: 0 })
    shippingAmount: number;

    @Prop({ default: 'pending', index: true }) // 'pending', 'deducted', 'error', 'skipped'
    logisticsStatus: string;

    @Prop()
    trackingCode: string;

    @Prop({ type: OrderCustomerSnapshot })
    customer: OrderCustomerSnapshot;

    @Prop({ type: Object })
    payment: {
        method: string;
        marketplaceFee: number;
        netAmount: number;
        installments: number;
    };

    @Prop({ type: [SchemaFactory.createForClass(OrderItemSnapshot)] })
    items: OrderItemSnapshot[];

    @Prop({ type: [{ type: Types.ObjectId, ref: 'StockMovementModel' }] })
    stockMovementIds: Types.ObjectId[];

    @Prop({ type: [SchemaFactory.createForClass(OrderLogSnapshot)] })
    logs: OrderLogSnapshot[];

    @Prop({
        type: [{
            status: String,
            at: Date,
            trigger: String,
            details: Object
        }],
        default: []
    })
    history: any[];

    @Prop({ default: 'idle', index: true }) // 'idle', 'processing', 'completed', 'failed'
    processingStatus: string;

    @Prop()
    syncedAt: Date;

    fiscalDocuments?: any[];
}

export const OrderSchema = SchemaFactory.createForClass(OrderModel);
OrderSchema.virtual('fiscalDocuments', {
    ref: 'FiscalDocumentModel',
    localField: '_id',
    foreignField: 'order'
});
OrderSchema.set('toObject', { virtuals: true });
OrderSchema.set('toJSON', { virtuals: true });
OrderSchema.index({ 'customer.document': 1 }); // Great for customer history lookup
