import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductNCMDocument = ProductNCMModel & Document;

@Schema({ collection: 'product_ncms' })
export class ProductNCMModel {
    @Prop({ required: true, unique: true })
    code: string;

    @Prop()
    description: string;
}

export const ProductNCMSchema = SchemaFactory.createForClass(ProductNCMModel);
