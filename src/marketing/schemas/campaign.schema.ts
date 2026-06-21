import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CampaignDocument = Campaign & Document;

export enum CampaignType {
    MANUAL_SELECTION = 'manual_selection',
    AUTO_QUERY = 'auto_query', // Uses MongoDB regex query
}

@Schema({ timestamps: true })
export class Campaign {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true, unique: true })
    slug: string;

    @Prop()
    description: string;

    @Prop({ required: true, enum: CampaignType })
    type: CampaignType;

    // For AUTO_QUERY
    @Prop()
    query: string; // e.g. 'category:brakes AND brand:bosch' or 'preventiva'

    // For MANUAL_SELECTION (List of Product IDs)
    @Prop([String])
    productIds: string[];

    @Prop({ default: true })
    active: boolean;

    @Prop()
    startDate: Date;

    @Prop()
    endDate: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
