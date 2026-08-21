import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type BoxDocument = BoxModel & Document;

@Schema({
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret: any) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
            return ret;
        }
    }
})
export class BoxModel {
    @Prop({ index: { unique: true, sparse: true } })
    code: string;

    @Prop({ type: String })
    description?: string;

    @Prop({ default: 0 })
    itemsCount: number;

    @Prop({ type: String })
    color?: string; // Hex color for ui purposes if any

    @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
    products: Types.ObjectId[];
}

export const BoxSchema = SchemaFactory.createForClass(BoxModel);
