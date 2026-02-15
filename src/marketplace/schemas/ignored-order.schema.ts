import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MarketplaceModel } from './marketplace.schema';

export type IgnoredOrderDocument = HydratedDocument<IgnoredOrderModel>;

@Schema({ collection: 'ignored_orders', timestamps: true })
export class IgnoredOrderModel {
    @Prop({ required: true, index: true })
    orderId: string;

    @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true })
    marketplace: MarketplaceModel | Types.ObjectId;


}

export const IgnoredOrderSchema = SchemaFactory.createForClass(IgnoredOrderModel);
