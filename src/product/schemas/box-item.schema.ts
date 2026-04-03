import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BoxItemDocument = BoxItemModel & Document;

@Schema({
    collection: 'box_items',
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
export class BoxItemModel {
    @Prop({ type: Types.ObjectId, ref: 'BoxModel', required: true, index: true })
    boxId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'ProductConditionModel', required: true })
    conditionId: Types.ObjectId;

    @Prop({ required: true, default: 1 })
    quantity: number;
}

export const BoxItemSchema = SchemaFactory.createForClass(BoxItemModel);
