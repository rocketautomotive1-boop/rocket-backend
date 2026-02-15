import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserProductivityDocument = HydratedDocument<UserProductivity>;

export enum ProductivityType {
    CREATE = 'CREATE',
    SYNC_SUCCESS = 'SYNC_SUCCESS',
    SYNC_ERROR = 'SYNC_ERROR'
}

@Schema({ collection: 'user_productivity', timestamps: true })
export class UserProductivity {
    @Prop({ required: true, index: true })
    userId: string;

    @Prop({ required: true, index: true })
    date: Date; // Normalized to start of day

    @Prop({ required: true, enum: ProductivityType })
    type: ProductivityType;

    @Prop({ type: Types.ObjectId })
    marketplaceId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId })
    productId?: Types.ObjectId;

    @Prop({ default: false })
    isError: boolean;

    @Prop({ type: Object })
    data?: {
        price?: number;
        errorMessage?: string;
        externalId?: string;
        action?: string;
        [key: string]: any;
    };
}

export const UserProductivitySchema = SchemaFactory.createForClass(UserProductivity);

// Indexes for fast aggregation
UserProductivitySchema.index({ userId: 1, date: 1 });
UserProductivitySchema.index({ userId: 1, type: 1, date: 1 });
