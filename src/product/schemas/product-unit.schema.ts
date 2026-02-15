import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductUnitDocument = ProductUnitModel & Document;

@Schema({ collection: 'product_units' })
export class ProductUnitModel {
    @Prop({ required: true, unique: true })
    code: string;

    @Prop({ required: true })
    name: string;
}

export const ProductUnitSchema = SchemaFactory.createForClass(ProductUnitModel);
