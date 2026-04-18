import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingModel } from '../listing/schemas/listing.schema';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { MarketplaceSyncResult } from './dto/marketplace-sync-result.dto';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { UserProductivityService } from '../monitoring/user-productivity.service';
import { ProductivityType } from '../monitoring/schemas/user-productivity.schema';
import { ProductAliasModel } from '../product/schemas/product-alias.schema';
import { ProductRepository } from '../product/product.repository';
import { SyncRequest, SyncRequestDocument } from './schemas/sync-request.schema';
import { SyncQueueService } from './services/sync-queue.service';

@Injectable()
export class ListingStatusListener {
    private readonly logger = new Logger(ListingStatusListener.name);

    constructor(
        @InjectModel(ListingModel.name) private listingModel: Model<ListingModel>,
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(ProductAliasModel.name) private productAliasModel: Model<ProductAliasModel>,
        @InjectModel(SyncRequest.name) private syncRequestModel: Model<SyncRequestDocument>,
        private readonly publicationLogService: PublicationLogService,
        private readonly userProductivityService: UserProductivityService,
        private readonly productRepository: ProductRepository,
        private readonly syncQueueService: SyncQueueService,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
    })
    async handleSyncResult(result: MarketplaceSyncResult) {
        this.logger.log(`Received result for job ${result.jobId}: ${result.success ? 'Success' : 'Failure'}`);
        const isAsyncPending = result.success && result.action === 'CREATE' && !result.externalId && !!result.metadata?.asyncPending;

        const listing = await this.listingModel.findById(result.listingId);
        if (!listing) {
            this.logger.error(`Listing ${result.listingId} not found for result processing`);
            return;
        }

        const userId = listing.marketplaceData?.userId || result.metadata?.userId || 'system';

        // Handle DELETE action separately
        if (result.action === 'DELETE') {
            if (result.success) {
                listing.status = 'removed';
                listing.synchronized = false;
                listing.publishingAt = null;
                listing.externalId = null;
                listing.errorMessage = null;
                listing.lastSyncAt = new Date();
                this.logger.log(`Listing ${result.listingId} successfully removed from marketplace`);
            } else {
                listing.status = 'error';
                listing.synchronized = false;
                listing.publishingAt = null;
                listing.errorMessage = result.errorMessage;
                this.logger.error(`Listing ${result.listingId} removal failed: ${result.errorMessage}`);
            }

            listing.marketplaceData = {
                ...listing.marketplaceData,
                lastJobId: result.jobId,
                lastAction: result.action,
                syncMetadata: result.metadata,
            };

            try {
                await listing.save();
            } catch (err) {
                this.logger.error(`Failed to save listing ${result.listingId} after DELETE: ${err.message}`);
            }

            if (result.attemptId) {
                const logResult = {
                    marketplaceId: result.marketplaceId,
                    status: result.success ? 'SUCCESS' : 'FAILED',
                    message: result.success ? 'Listing removed from marketplace' : result.errorMessage,
                    timestamp: new Date(),
                    metadata: { action: 'DELETE' },
                };
                await this.publicationLogService.completeAttempt(result.attemptId, [logResult as any]);
            }
            return;
        }

        if (result.success) {
            if (isAsyncPending) {
                listing.status = 'pending_creation';
                listing.synchronized = false;
                listing.publishingAt = null; // Release in-flight lock for future retries/reconciliation
                listing.errorMessage = null;
                listing.lastSyncAt = new Date();

                this.logger.log(
                    `Listing ${result.listingId} accepted by marketplace in async mode. ` +
                    `Waiting externalId (importToken=${result.metadata?.importToken || 'N/A'}).`,
                );
            } else {
            listing.status = 'active';
            listing.synchronized = true;
            listing.publishingAt = null; // Release in-flight lock
            if (result.externalId) {
                listing.externalId = result.externalId;
            }
            listing.errorMessage = null;
            listing.lastSyncAt = new Date();
            }

            // Auto-create ProductAlias so future orders can resolve productId by externalId/sku
            if (result.externalId && listing.productId) {
                try {
                    await this.productAliasModel.findOneAndUpdate(
                        { marketplaceId: listing.marketplaceId, externalId: result.externalId },
                        {
                            $setOnInsert: {
                                product: listing.productId,
                                source: 'auto',
                                confidence: 1,
                                sku: result.externalId,
                            },
                        },
                        { upsert: true, new: false }
                    );
                } catch (aliasErr) {
                    // DuplicateKey (11000) means alias already exists — safe to ignore
                    if (aliasErr?.code !== 11000) {
                        this.logger.warn(`Failed to upsert ProductAlias for listing ${listing._id}: ${aliasErr.message}`);
                    }
                }
            }

            let price = listing.price || 0;
            let quantity = 0;

            try {
                const product = await this.productModel.findById(listing.productId).select('price').lean();
                if (product) {
                    if (!listing.price) {
                        price = Number(product.price) || 0;
                    }
                    quantity = await this.productRepository.calculateStock(listing.productId.toString());
                }
            } catch (err) {
                this.logger.warn(`Failed to fetch product for listing ${listing._id} to log productivity`);
            }

            // Log Productivity - Success
            await this.userProductivityService.logActivity(userId, ProductivityType.SYNC_SUCCESS, {
                marketplaceId: result.marketplaceId,
                productId: listing.productId.toString(),
                price: price,
                quantity: quantity,
                externalId: result.externalId
            });

        } else {
            listing.status = 'error';
            listing.synchronized = false;
            listing.publishingAt = null; // Release in-flight lock
            listing.errorMessage = result.errorMessage;

            // Log Productivity - Error
            await this.userProductivityService.logActivity(userId, ProductivityType.SYNC_ERROR, {
                marketplaceId: result.marketplaceId,
                productId: listing.productId.toString(),
                errorMessage: result.errorMessage,
                isError: true
            });
        }

        listing.marketplaceData = {
            ...listing.marketplaceData,
            lastJobId: result.jobId,
            lastAction: result.action,
            syncMetadata: result.metadata
        };

        try {
            await listing.save();
        } catch (err) {
            if (err?.code === 11000) {
                // Another listing already owns this externalId for this marketplace.
                // Persist status/sync fields without touching externalId.
                this.logger.warn(
                    `Listing ${listing._id}: externalId "${listing.externalId}" conflicts with existing listing for marketplace ${listing.marketplaceId}. Updating status fields only.`
                );
                await this.listingModel.updateOne(
                    { _id: listing._id },
                    {
                        $set: {
                            status: listing.status,
                            synchronized: listing.synchronized,
                            publishingAt: null,
                            errorMessage: listing.errorMessage,
                            lastSyncAt: listing.lastSyncAt,
                            marketplaceData: listing.marketplaceData,
                        },
                    }
                );
            } else {
                throw err;
            }
        }

        // Update Publication Log
        if (result.attemptId && !isAsyncPending) {
            const logResult = {
                marketplaceId: result.marketplaceId,
                status: result.success ? 'SUCCESS' : 'FAILED',
                message: result.success ? `Synced. External ID: ${result.externalId || 'N/A'}` : result.errorMessage,
                timestamp: new Date(),
                metadata: {
                    externalId: result.externalId,
                    action: result.action
                }
            };

            // We need to pass an array of results to completeAttempt
            await this.publicationLogService.completeAttempt(result.attemptId, [logResult as any]);
        }

        if (result.syncRequestId) {
            const updated = await this.syncRequestModel.findOneAndUpdate(
                { _id: result.syncRequestId, status: 'dispatched' },
                {
                    $push: {
                        marketplaceResults: {
                            marketplaceId: result.marketplaceId,
                            success: result.success,
                            errorMessage: result.errorMessage,
                            timestamp: new Date(),
                        },
                    },
                    $inc: { pendingResultCount: -1 },
                },
                { new: true },
            ).lean().exec();

            if (updated && updated.pendingResultCount <= 0) {
                const allSuccess = updated.marketplaceResults.every(r => r.success);
                await this.syncRequestModel.findByIdAndUpdate(result.syncRequestId, {
                    $set: {
                        status: allSuccess ? 'completed' : 'failed',
                        completedAt: new Date(),
                        errorMessage: allSuccess
                            ? null
                            : updated.marketplaceResults.filter(r => !r.success).map(r => r.errorMessage).join('; '),
                    },
                });

                if (!allSuccess && updated.reason !== 'selective_retry') {
                    const failedMarketplaceIds = updated.marketplaceResults
                        .filter(r => !r.success)
                        .map(r => r.marketplaceId);

                    if (failedMarketplaceIds.length > 0) {
                        await this.syncQueueService.enqueue({
                            productId: updated.productId.toString(),
                            force: false,
                            reason: 'selective_retry',
                            targetMarketplaceIds: failedMarketplaceIds,
                            scheduledAt: new Date(Date.now() + 60_000),
                        });
                    }
                }
            }
        }
    }
}
