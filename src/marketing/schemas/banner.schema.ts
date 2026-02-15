import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BannerDocument = Banner & Document;

export enum BannerActionType {
    LINK = 'link', // Internal link
    EXTERNAL_LINK = 'external_link',
    DIALOG = 'dialog', // e.g., 'search'
    SEARCH_QUERY = 'search_query', // e.g. 'q=preventiva'
    CAMPAIGN = 'campaign', // Link to a campaign slug
}

export enum BannerPosition {
    HERO_MAIN = 'hero_main', // The large one
    HERO_SIDE_TOP = 'hero_side_top',
    HERO_SIDE_BOTTOM_1 = 'hero_side_bottom_1',
    HERO_SIDE_BOTTOM_2 = 'hero_side_bottom_2',
}

@Schema({ timestamps: true })
export class Banner {
    @Prop({ required: true })
    title: string;

    @Prop()
    subtitle: string;

    @Prop({ required: true })
    imageDesktop: string;

    @Prop()
    imageMobile: string; // Optional, fallback to desktop

    @Prop({ required: true, enum: BannerActionType })
    actionType: BannerActionType;

    @Prop({ required: true })
    actionValue: string; // URL, Dialog Name, or Query

    @Prop({ required: true, enum: BannerPosition })
    position: BannerPosition;

    @Prop({ default: 0 })
    order: number; // For sorting if we have multiple in same position (carousel?)

    @Prop({ default: true })
    active: boolean;

    @Prop()
    startDate: Date;

    @Prop()
    endDate: Date;

    @Prop()
    badgeText: string;

    @Prop()
    badgeColor: string; // CSS class or hex
}

export const BannerSchema = SchemaFactory.createForClass(Banner);
