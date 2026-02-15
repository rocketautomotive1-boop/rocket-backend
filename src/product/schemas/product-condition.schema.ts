import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductConditionDocument = ProductConditionModel & Document;

@Schema({ collection: 'product_conditions' })
export class ProductConditionModel {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true, unique: true })
    slug: string;
}

export const ProductConditionSchema = SchemaFactory.createForClass(ProductConditionModel);
