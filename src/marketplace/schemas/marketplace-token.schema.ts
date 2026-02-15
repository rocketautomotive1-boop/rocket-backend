import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MarketplaceTokenDocument = MarketplaceToken & Document;

@Schema({ timestamps: true, collection: 'marketplace_tokens' })
export class MarketplaceToken {
    @Prop({ type: {} })
    marketplaceId: number | string | any;


    @Prop({ required: true })
    accessToken: string;

    @Prop()
    refreshToken: string;

    @Prop()
    expiresAt: Date;

    @Prop()
    tokenType: string;

    @Prop({ type: Object })
    additionalData: Record<string, any>;

    @Prop({ default: true })
    isActive: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}

export const MarketplaceTokenSchema = SchemaFactory.createForClass(MarketplaceToken);
