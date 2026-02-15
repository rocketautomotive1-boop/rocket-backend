import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VehicleDocument = HydratedDocument<VehicleModel>;

@Schema({ collection: 'vehicles', timestamps: true })
export class VehicleModel {
    @Prop({ required: true })
    brand: string;

    @Prop({ required: true })
    model: string;

    @Prop({ required: true })
    year: string;

    @Prop()
    version: string;

    @Prop()
    engine: string;

    @Prop()
    plate: string;

    @Prop()
    imageUrl: string;
}

export const VehicleSchema = SchemaFactory.createForClass(VehicleModel);
