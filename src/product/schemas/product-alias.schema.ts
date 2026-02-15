import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductAliasDocument = HydratedDocument<ProductAliasModel>;

@Schema({ collection: 'product_aliases', timestamps: true })
export class ProductAliasModel {
    _id: string;

    @Prop({ type: Types.ObjectId, required: true, index: true })
    marketplaceId: Types.ObjectId;

    @Prop({ required: true, index: true })
    externalId: string; // ID in the Marketplace (e.g., MLB123456)

    @Prop({ default: 'manual' })
    source: string; // 'manual', 'ai', 'auto-match'

    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
    product: Types.ObjectId;

    @Prop()
    sku?: string; // Optional: The SKU it was matched to

    @Prop({ default: 1 }) // High confidence = 1, Low = 0.x
    confidence: number;
}

export const ProductAliasSchema = SchemaFactory.createForClass(ProductAliasModel);

// Ensure unique match per marketplace+externalId
ProductAliasSchema.index({ marketplaceId: 1, externalId: 1 }, { unique: true });
