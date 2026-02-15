import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type BrandDocument = HydratedDocument<BrandModel>;

@Schema({ collection: 'brands', timestamps: true })
export class BrandModel {
    id: string;

    @Prop({ required: true, index: true, unique: true })
    name: string;

    @Prop()
    logoUrl?: string;

    @Prop({ default: true })
    isGenuine: boolean;

    @Prop()
    shortName?: string;

    @Prop()
    fullName?: string;

    @Prop()
    amazonName?: string;

    @Prop()
    description?: string;

    @Prop({ default: true })
    active: boolean;


}

export const BrandSchema = SchemaFactory.createForClass(BrandModel);
