import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDiscoveryDocument = ProductDiscoveryModel & Document;

@Schema({ collection: 'product_discoveries', timestamps: true })
export class ProductDiscoveryModel {
    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: false, index: true })
    productId: Types.ObjectId;

    @Prop({ required: true })
    query: string;

    @Prop({ index: true })
    batchId: string;

    @Prop({ default: 'pending', index: true })
    status: string;

    @Prop({ type: Object }) // AI Sanitized results
    data: any;

    @Prop({ type: [Object], default: [] }) // Original search snippets
    rawItems: any[];

    @Prop()
    error: string;
}

export const ProductDiscoverySchema = SchemaFactory.createForClass(ProductDiscoveryModel);
