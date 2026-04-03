import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SyncRequest, SyncRequestDocument } from '../schemas/sync-request.schema';
import { MarketplaceOrchestratorService } from '../marketplace-orchestrator.service';

const POLL_INTERVAL_MS = 3_000;
const BATCH_SIZE = 5;
/** Items stuck in `processing` for longer than this are considered crashed and reset. */
const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

@Injectable()
export class SyncQueueWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SyncQueueWorker.name);
    private pollInterval: NodeJS.Timeout;
    private isProcessing = false;

    constructor(
        @InjectModel(SyncRequest.name) private readonly syncRequestModel: Model<SyncRequestDocument>,
        private readonly orchestrator: MarketplaceOrchestratorService,
    ) {}

    onModuleInit() {
        this.pollInterval = setInterval(() => this.processQueue(), POLL_INTERVAL_MS);
        this.logger.log(`SyncQueueWorker started (polling every ${POLL_INTERVAL_MS / 1000}s).`);
    }

    onModuleDestroy() {
        if (this.pollInterval) clearInterval(this.pollInterval);
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            await this.recoverStaleItems();
            await this.processNextBatch();
        } catch (err) {
            this.logger.error(`[SyncQueueWorker] Unhandled error in poll cycle: ${err.message}`, err.stack);
        } finally {
            this.isProcessing = false;
        }
    }

    private async processNextBatch() {
        const now = new Date();
        const pending = await this.syncRequestModel
            .find({ status: 'pending', scheduledAt: { $lte: now } })
            .sort({ scheduledAt: 1 }) // Oldest first (FIFO), respects backoff scheduling
            .limit(BATCH_SIZE)
            .lean()
            .exec();

        for (const item of pending) {
            // Atomic claim: if another worker (or a concurrent poll cycle) already grabbed
            // this item, findOneAndUpdate returns null and we skip it.
            const claimed = await this.syncRequestModel.findOneAndUpdate(
                { _id: item._id, status: 'pending' },
                { $set: { status: 'processing', processingStartedAt: now } },
            ).exec();

            if (!claimed) {
                this.logger.debug(`[SyncQueueWorker] Item ${item._id} already claimed — skipping.`);
                continue;
            }

            await this.processItem(item as any);
        }
    }

    private async processItem(item: SyncRequestDocument) {
        const productId = item.productId.toString();
        const marketplaceId = item.marketplaceId?.toString();

        this.logger.log(
            `[SyncQueueWorker] Processing ${item._id} | product=${productId}` +
            (marketplaceId ? ` marketplace=${marketplaceId}` : ' (all)') +
            ` reason=${item.reason ?? '-'} force=${item.force} retry=${item.retryCount}`,
        );

        try {
            await this.orchestrator.syncProductToAllMarketplaces(
                productId,
                marketplaceId,
                item.requesterId,
                item.force,
            );

            await this.syncRequestModel.updateOne(
                { _id: item._id },
                { $set: { status: 'completed', completedAt: new Date(), errorMessage: null } },
            ).exec();

            this.logger.log(`[SyncQueueWorker] Completed ${item._id}`);

        } catch (err) {
            const nextRetry = item.retryCount + 1;
            const maxRetries = item.maxRetries ?? 3;

            if (nextRetry > maxRetries) {
                await this.syncRequestModel.updateOne(
                    { _id: item._id },
                    { $set: { status: 'failed', errorMessage: err.message, completedAt: new Date() } },
                ).exec();
                this.logger.error(
                    `[SyncQueueWorker] Permanently failed ${item._id} after ${maxRetries} retries: ${err.message}`,
                );
            } else {
                // Exponential backoff: 30s, 60s, 120s, ... capped at 30 minutes.
                const backoffMs = Math.min(Math.pow(2, item.retryCount) * 30_000, 30 * 60_000);
                const scheduledAt = new Date(Date.now() + backoffMs);

                try {
                    await this.syncRequestModel.updateOne(
                        { _id: item._id },
                        {
                            $set: { status: 'pending', scheduledAt, errorMessage: err.message },
                            $inc: { retryCount: 1 },
                        },
                    ).exec();

                    this.logger.warn(
                        `[SyncQueueWorker] Retry ${nextRetry}/${maxRetries} for ${item._id} ` +
                        `scheduled at ${scheduledAt.toISOString()} (backoff=${backoffMs / 1000}s): ${err.message}`,
                    );
                } catch (retryErr) {
                    if (retryErr.code === 11000) {
                        // A newer pending entry already exists for this product+marketplace.
                        // The current item is superseded — delete it to keep the queue clean.
                        await this.syncRequestModel.deleteOne({ _id: item._id }).exec();
                        this.logger.warn(
                            `[SyncQueueWorker] Retry for ${item._id} superseded by newer pending entry ` +
                            `(product=${productId}) — deleted stale item.`,
                        );
                    } else {
                        throw retryErr;
                    }
                }
            }
        }
    }

    /**
     * Items stuck in `processing` beyond STALE_THRESHOLD_MS are reset to `pending`.
     * This handles crashes, container restarts, or any case where the worker died mid-job.
     *
     * Uses per-item logic instead of updateMany to avoid E11000 collisions: if a fresh
     * `pending` entry already exists for the same productId+marketplaceId, the stale
     * processing item is superseded and gets deleted instead of being reset.
     */
    private async recoverStaleItems() {
        const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
        const staleItems = await this.syncRequestModel
            .find({ status: 'processing', processingStartedAt: { $lte: staleThreshold } })
            .lean()
            .exec();

        let recovered = 0;
        for (const item of staleItems) {
            const existingPending = await this.syncRequestModel.findOne({
                productId: item.productId,
                marketplaceId: item.marketplaceId,
                status: 'pending',
                _id: { $ne: item._id },
            }).lean().exec();

            if (existingPending) {
                // A newer pending entry already covers this sync — remove the stale one.
                await this.syncRequestModel.deleteOne({ _id: item._id }).exec();
                this.logger.warn(
                    `[SyncQueueWorker] Stale item ${item._id} superseded by pending ${existingPending._id} — deleted.`,
                );
            } else {
                await this.syncRequestModel.updateOne(
                    { _id: item._id },
                    {
                        $set: {
                            status: 'pending',
                            scheduledAt: new Date(),
                            errorMessage: 'Recovered from stale processing state (worker crashed or restarted).',
                        },
                    },
                ).exec();
                recovered++;
            }
        }

        if (recovered > 0) {
            this.logger.warn(`[SyncQueueWorker] Recovered ${recovered} stale item(s).`);
        }
    }
}
