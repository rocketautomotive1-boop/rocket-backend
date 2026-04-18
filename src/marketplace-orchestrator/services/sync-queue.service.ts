import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SyncRequest, SyncRequestDocument } from '../schemas/sync-request.schema';

export interface EnqueueOptions {
    productId: string;
    /** Omit to sync all marketplaces. */
    marketplaceId?: string;
    requesterId?: string;
    /** When true, bypasses the in-flight AtomicGuard inside publishListing(). */
    force?: boolean;
    /** Human-readable reason (e.g. 'price_change', 'user_publish'). */
    reason?: string;
    /** Defaults to now. Set a future date for scheduled/backoff retries. */
    scheduledAt?: Date;
    /** When set, only sync these specific marketplaces (by ID string). Omit to sync all. */
    targetMarketplaceIds?: string[];
}

@Injectable()
export class SyncQueueService {
    private readonly logger = new Logger(SyncQueueService.name);

    constructor(
        @InjectModel(SyncRequest.name) private readonly syncRequestModel: Model<SyncRequestDocument>,
    ) {}

    /**
     * Atomically enqueue a sync request.
     *
     * Deduplication rule: only one `pending` entry is allowed per productId+marketplaceId
     * (enforced by a partial unique index on the collection).
     *
     * - If no pending entry exists → INSERT a new one.
     * - If a pending entry exists → UPDATE scheduledAt (and force/reason).
     *   This means the latest enqueue wins the scheduling time, so an explicit user publish
     *   always moves the job to "due now" even if the watcher had already queued it for later.
     *
     * On a race between two concurrent upserts (both pass the findOneAndUpdate check at the
     * same instant), MongoDB will throw DuplicateKey (code 11000). We catch that and return
     * the existing document — the intent is already recorded.
     */
    async enqueue(opts: EnqueueOptions): Promise<SyncRequestDocument> {
        const productId = new Types.ObjectId(opts.productId);
        const marketplaceId = opts.marketplaceId ? new Types.ObjectId(opts.marketplaceId) : null;
        const scheduledAt = opts.scheduledAt ?? new Date();

        // Build $set carefully: only upgrade force (false → true), never downgrade (true → false).
        // This ensures a user_publish enqueue (force=true) is not clobbered by a subsequent
        // watcher enqueue (force=false) for the same pending record.
        const setFields: Record<string, any> = {
            scheduledAt,
            requesterId: opts.requesterId,
            reason: opts.reason,
        };
        if (opts.force) {
            setFields.force = true;
        }
        if (opts.targetMarketplaceIds?.length) {
            setFields.targetMarketplaceIds = opts.targetMarketplaceIds;
        }

        // When targetMarketplaceIds is absent/empty the intent is "sync all".
        // If a previous enqueue had stored a selective list, we must remove it so
        // the document correctly reflects the broader intent.
        const updateDoc: Record<string, any> = {
            $set: setFields,
            $setOnInsert: {
                retryCount: 0,
                maxRetries: 3,
                // Schema default (false) handles force for new documents when opts.force
                // is falsy, so we do NOT include force here to avoid a field-conflict
                // error when $set also sets force=true on the same upsert-insert.
            },
        };
        if (!opts.targetMarketplaceIds?.length) {
            updateDoc.$unset = { targetMarketplaceIds: '' };
        }

        // Selective-retry enqueues must not narrow an existing full-sync pending document.
        // By adding targetMarketplaceIds: { $exists: true } to the filter when targeting
        // specific marketplaces, we ensure they only match (and update) other selective
        // entries — full-sync pending docs remain untouched and a new document is inserted.
        const filter: Record<string, any> = { productId, marketplaceId, status: 'pending' };
        if (opts.targetMarketplaceIds?.length) {
            filter.targetMarketplaceIds = { $exists: true };
        }

        try {
            const doc = await this.syncRequestModel.findOneAndUpdate(
                filter,
                updateDoc,
                { upsert: true, new: true },
            ).exec();

            this.logger.log(
                `[SyncQueue] Enqueued ${doc._id} | product=${opts.productId}` +
                (opts.marketplaceId ? ` marketplace=${opts.marketplaceId}` : ' (all marketplaces)') +
                ` reason=${opts.reason ?? 'unspecified'} force=${opts.force ?? false}`,
            );

            return doc;
        } catch (err) {
            // Two concurrent upserts for the same key can collide on the unique index.
            // The request is already in the queue — return the existing document.
            if (err.code === 11000) {
                this.logger.warn(
                    `[SyncQueue] Concurrent enqueue collision for product ${opts.productId} — already pending, ignoring.`,
                );
                return this.syncRequestModel
                    .findOne({ productId, marketplaceId, status: 'pending' })
                    .exec();
            }
            throw err;
        }
    }
}
