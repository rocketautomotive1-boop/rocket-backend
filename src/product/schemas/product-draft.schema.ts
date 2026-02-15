import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductDraftDocument = ProductDraftModel & Document;

@Schema({ collection: 'product_drafts', timestamps: true })
export class ProductDraftModel {
    @Prop()
    productId: string;

    @Prop()
    name: string;

    @Prop({ index: true })
    batchId: string;

    @Prop()
    sourceImageUrl: string;

    @Prop()
    mimeType: string;

    @Prop({ default: 'pending' })
    status: string;

    @Prop({ type: Object }) // Storing as native Object/Mixed
    data: any;

    @Prop()
    error: string;
}

export const ProductDraftSchema = SchemaFactory.createForClass(ProductDraftModel);
