import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PublicationStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    SUCCESS = 'SUCCESS',
    ERROR = 'ERROR',
}

export type ProductPublicationLogDocument = ProductPublicationLogModel & Document;

@Schema({ collection: 'product_publication_logs', timestamps: true })
export class ProductPublicationLogModel {
    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    product: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true })
    marketplace: Types.ObjectId;

    @Prop({ required: true, index: true })
    bucketStart: Date; // Timestamp inicial do bucket (ex: hora ou dia)

    @Prop({ required: true, index: true })
    bucketEnd: Date; // Timestamp final do bucket

    @Prop({ default: 0 })
    count: number; // Contador de logs neste bucket

    @Prop({
        type: [{
            _id: { type: Types.ObjectId, default: () => new Types.ObjectId() },
            timestamp: { type: Date, default: Date.now },
            status: String,
            message: String,
            metadata: Object
        }],
        _id: false // Container array doesn't need ID, but items do
    })
    logs: {
        _id?: Types.ObjectId;
        timestamp: Date;
        status: string;
        message: string;
        metadata?: any;
    }[];
}

export const ProductPublicationLogSchema = SchemaFactory.createForClass(ProductPublicationLogModel);

// Compound index for efficient retrieval of buckets by product and time
ProductPublicationLogSchema.index({ product: 1, marketplace: 1, bucketStart: -1 });
