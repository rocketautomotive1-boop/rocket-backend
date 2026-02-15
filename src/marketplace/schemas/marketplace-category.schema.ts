import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MarketplaceModel } from './marketplace.schema';

export type MarketplaceCategoryDocument = HydratedDocument<MarketplaceCategoryModel>;

@Schema({ collection: 'marketplace_categories', timestamps: true })
export class MarketplaceCategoryModel {
    @Prop({ required: true, index: true })
    externalId: string;

    @Prop({ required: true })
    name: string;

    @Prop()
    parentId: string;

    @Prop()
    path: string;

    @Prop({ type: [{ id: String, name: String }] })
    path_from_root: { id: string; name: string }[];

    @Prop()
    level: number;

    @Prop({ default: true })
    isLeaf: boolean;

    @Prop({ type: Object })
    attributes: Record<string, any>;

    @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true })
    marketplace: MarketplaceModel | Types.ObjectId;

    @Prop({
        type: {
            height: Number,
            width: Number,
            length: Number,
            weight: Number
        }
    })
    dimensions: {
        height: number;
        width: number;
        length: number;
        weight: number;
    };
}

export const MarketplaceCategorySchema = SchemaFactory.createForClass(MarketplaceCategoryModel);
