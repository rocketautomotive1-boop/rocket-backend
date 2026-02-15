import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CrossReferenceGroupDocument = HydratedDocument<CrossReferenceGroupModel>;

@Schema()
export class CrossReferenceCode {
    @Prop({ required: true })
    brand: string;

    @Prop({ required: true, index: true })
    partNumber: string;
}

@Schema({ collection: 'cross_reference_groups', timestamps: true })
export class CrossReferenceGroupModel {
    _id: string;

    @Prop({ type: [SchemaFactory.createForClass(CrossReferenceCode)], index: true })
    codes: CrossReferenceCode[];
}

export const CrossReferenceGroupSchema = SchemaFactory.createForClass(CrossReferenceGroupModel);

// Ensure unique index on brand+partNumber combination within the array?
// MongoDB multikey indexes don't strictly enforce uniqueness of subdocument *combinations* across collection easily without specific setup.
// But we want to be able to search `codes.partNumber`.
// A compound index on `codes.partNumber` is already useful.
