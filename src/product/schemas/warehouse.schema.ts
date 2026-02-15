import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WarehouseDocument = WarehouseModel & Document;

@Schema({ collection: 'warehouses', timestamps: true })
export class WarehouseModel {
    @Prop({ required: true, unique: true, index: true })
    name: string;

    @Prop()
    address: string;
}

export const WarehouseSchema = SchemaFactory.createForClass(WarehouseModel);
