import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SyncRequestDocument = HydratedDocument<SyncRequest>;

@Schema({ collection: 'sync_requests', timestamps: true })
export class SyncRequest {
    @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true })
    productId: Types.ObjectId;

    /**
     * null = sync all marketplaces for this product.
     * ObjectId = sync only that specific marketplace.
     */
    @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', default: null })
    marketplaceId: Types.ObjectId | null;

    @Prop({
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending',
    })
    status: string;

    /** Number of retries attempted so far. */
    @Prop({ type: Number, default: 0 })
    retryCount: number;

    @Prop({ type: Number, default: 3 })
    maxRetries: number;

    /** When the worker should pick this item up. Used for exponential backoff. */
    @Prop({ type: Date, default: () => new Date() })
    scheduledAt: Date;

    @Prop({ type: String })
    requesterId?: string;

    /**
     * When true, bypasses the AtomicGuard inside publishListing().
     * Set to true for explicit user-triggered publishes.
     */
    @Prop({ type: Boolean, default: false })
    force: boolean;

    /** Human-readable reason for this sync request (e.g. 'price_change', 'user_publish'). */
    @Prop({ type: String })
    reason?: string;

    @Prop({ type: String })
    errorMessage?: string;

    @Prop({ type: Date })
    processingStartedAt?: Date;

    @Prop({ type: Date })
    completedAt?: Date;
}

export const SyncRequestSchema = SchemaFactory.createForClass(SyncRequest);

/**
 * Partial unique index: guarantees at most one `pending` request per productId+marketplaceId.
 * This is the primary deduplication mechanism — concurrent enqueue calls (watcher vs.
 * frontend) will collapse into a single pending row via findOneAndUpdate upsert.
 */
SyncRequestSchema.index(
    { productId: 1, marketplaceId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'pending' },
        name: 'unique_pending_per_product_marketplace',
    },
);

/** Index for the worker to efficiently find due items. */
SyncRequestSchema.index({ status: 1, scheduledAt: 1 });
