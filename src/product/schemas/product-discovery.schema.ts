import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDiscoveryDocument = ProductDiscoveryModel & Document;

@Schema({ collection: 'product_discoveries', timestamps: true })
export class ProductDiscoveryModel {
    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: false, index: true })
    productId: Types.ObjectId;

    @Prop({ required: true })
    query: string;

    @Prop({ index: true })
    batchId: string;

    @Prop({ default: 'pending', index: true })
    status: string;

    @Prop({ type: Object }) // AI Sanitized results
    data: any;

    @Prop({ type: [Object], default: [] }) // Original search snippets
    rawItems: any[];

    @Prop()
    error: string;

    /** Dedup: PN normalizado (trim + uppercase). Documentos antigos sem estes campos não entram no dedup até backfill opcional. */
    @Prop({ index: true })
    partNumberNorm: string;

    /**
     * Dedup: marca normalizada (trim + lowercase); vazio quando isGenuine (mesma convenção que query só-PN).
     */
    @Prop({ index: true, default: '' })
    brandNorm: string;

    @Prop({ default: false, index: true })
    isGenuine: boolean;

    @Prop({ type: Types.ObjectId, ref: 'BrandModel', required: false, index: true })
    brandId: Types.ObjectId;

    @Prop({ type: [String], default: [] })
    suggestedImages: string[];
}

export const ProductDiscoverySchema = SchemaFactory.createForClass(ProductDiscoveryModel);

ProductDiscoverySchema.index({
    partNumberNorm: 1,
    brandNorm: 1,
    isGenuine: 1,
    status: 1,
    createdAt: -1,
});

// Atomic dedup: only one in-flight (pending) job per unique key.
// The upsert in startDiscovery atomically claims the slot; concurrent
// requests get a DuplicateKey error and reuse the existing batchId.
ProductDiscoverySchema.index(
    { partNumberNorm: 1, brandNorm: 1, isGenuine: 1 },
    { unique: true, sparse: true, partialFilterExpression: { status: 'pending' } },
);
