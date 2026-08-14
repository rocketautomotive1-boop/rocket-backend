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

    @Prop()
    error: string;

    /** Dedup: PN normalizado (trim + uppercase). Documentos antigos sem estes campos nÃ£o entram no dedup atÃ© backfill opcional. */
    @Prop({ index: true })
    partNumberNorm: string;

    /**
     * Dedup: marca normalizada (trim + lowercase); vazio quando isGenuine (mesma convenÃ§Ã£o que query sÃ³-PN).
     */
    @Prop({ index: true, default: '' })
    brandNorm: string;

    @Prop({ default: false, index: true })
    isGenuine: boolean;

    @Prop({ type: Types.ObjectId, ref: 'BrandModel', required: false, index: true })
    brandId: Types.ObjectId;

    /**
     * Per-source scored evidence: `sources.mercadolivre` and `sources.serp`.
     * Each entry contains `items`, `images`, `acceptedItems`, `rejectedItems`, `confidence`.
     * Null for legacy documents.
     */
    @Prop({ type: Object, default: null })
    sources: Record<string, any> | null;

    /**
     * Synthesized final result. Contains `mode`, `preferredSource`, `prices`,
     * `suggestedImages`, `titles`, `vehicles`, `oemCodes`, `confidence`, etc.
     * Supercedes flat fields for new documents; legacy documents have this as null.
     */
    @Prop({ type: Object, default: null })
    final: Record<string, any> | null;

    /**
     * Category resolved automatically from categoryPath via CategoryResolutionService.
     * Null when no match found — user must select manually.
     */
    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', required: false, index: true })
    resolvedCategoryId?: Types.ObjectId;

    /**
     * Product-scoped intent model: monotonic version per product. A new explicit
     * discovery run supersedes the previous active intent and bumps this.
     */
    @Prop({ default: 1, index: true })
    intentVersion: number;

    /** True for the current active intent; false once superseded by a newer run. */
    @Prop({ default: true, index: true })
    isActiveIntent: boolean;

    /** When this intent was superseded by a newer one (null while active). */
    @Prop({ type: Date, default: null })
    supersededAt: Date | null;

    createdAt?: Date;
    updatedAt?: Date;
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

