
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AnalyticsEventDocument = AnalyticsEvent & Document;

@Schema({ timestamps: true })
export class AnalyticsEvent {
    @Prop({ required: false })
    userId?: string; // Optional (guest users)

    @Prop({ required: true })
    sessionId: string;

    @Prop({ required: true, enum: ['SEARCH', 'VIEW_PRODUCT', 'ADD_TO_CART', 'PURCHASE', 'LOGIN', 'REGISTER', 'PAGE_VIEW'] })
    eventType: string;

    @Prop({ type: MongooseSchema.Types.Mixed })
    payload: any; // Flexible payload (e.g., search term, product ID, cart total)

    @Prop({ type: MongooseSchema.Types.Mixed })
    metadata: {
        ip?: string;
        userAgent?: string;
        geo?: {
            country?: string;
            region?: string;
            city?: string;
            ll?: number[];
        };
        url?: string;
    };
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);
