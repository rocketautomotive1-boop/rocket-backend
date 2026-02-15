import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<ReviewModel>;

@Schema({ collection: 'reviews', timestamps: true })
export class ReviewModel {
    _id: string;

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    productId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true })
    userId: Types.ObjectId;

    @Prop({ required: true, min: 1, max: 5 })
    rating: number;

    @Prop({ required: true })
    comment: string;

    @Prop({ type: [String], default: [] })
    photos: string[];

    @Prop({ default: 0 })
    helpfulCount: number;

    @Prop({ default: 'APPROVED', enum: ['PENDING', 'APPROVED', 'REJECTED'] })
    status: string;

    @Prop()
    createdAt?: Date;

    @Prop()
    updatedAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(ReviewModel);

// Compound index to prevent multiple reviews from same user on same product (optional rule)
ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
