import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductWarrantyDocument = ProductWarrantyModel & Document;

@Schema({ collection: 'product_warranties' })
export class ProductWarrantyModel {
    @Prop({ required: true })
    time: number;

    @Prop({ required: true })
    unit: string; // days, months, years

    @Prop()
    description: string;
}

export const ProductWarrantySchema = SchemaFactory.createForClass(ProductWarrantyModel);
