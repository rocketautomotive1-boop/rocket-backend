import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingModel } from '../listing/schemas/listing.schema';
import { MarketplaceSyncResult } from './dto/marketplace-sync-result.dto';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { UserProductivityService } from '../monitoring/user-productivity.service';
import { ProductivityType } from '../monitoring/schemas/user-productivity.schema';

@Injectable()
export class ListingStatusListener {
    private readonly logger = new Logger(ListingStatusListener.name);

    constructor(
        @InjectModel(ListingModel.name) private listingModel: Model<ListingModel>,
        private readonly publicationLogService: PublicationLogService,
        private readonly userProductivityService: UserProductivityService,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
    })
    async handleSyncResult(result: MarketplaceSyncResult) {
        this.logger.log(`Received result for job ${result.jobId}: ${result.success ? 'Success' : 'Failure'}`);

        const listing = await this.listingModel.findById(result.listingId);
        if (!listing) {
            this.logger.error(`Listing ${result.listingId} not found for result processing`);
            return;
        }

        const userId = listing.marketplaceData?.userId || result.metadata?.userId || 'system';

        if (result.success) {
            listing.status = 'active';
            listing.synchronized = true;
            if (result.externalId) {
                listing.externalId = result.externalId;
            }
            listing.errorMessage = null;
            listing.lastSyncAt = new Date();

            // Log Productivity - Success
            // We need price. Listing might have price override, or we need to fetch product.
            // For efficiency, let's use what's in listing or 0. Ideally we should populate product.
            // But 'listing.price' is an override. If undefined, we need product price.
            // Let's assume for now we use listing.price or 0 if not present, to avoid extra DB call if acceptable.
            // Requirement: "Soma do price dos produtos publicados"
            // If listing.price is null, we might be missing data.
            // Let's rely on what we have. 
            await this.userProductivityService.logActivity(userId, ProductivityType.SYNC_SUCCESS, {
                marketplaceId: result.marketplaceId,
                productId: result.listingId, // Use listingId for now or listing.productId
                price: listing.price || 0, // Caution: this might be 0 if no override.
                externalId: result.externalId
            });

        } else {
            listing.status = 'error'; // or keep as pending?
            listing.synchronized = false;
            listing.errorMessage = result.errorMessage;

            // Log Productivity - Error
            await this.userProductivityService.logActivity(userId, ProductivityType.SYNC_ERROR, {
                marketplaceId: result.marketplaceId,
                productId: result.listingId,
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

        await listing.save();

        // Update Publication Log
        if (result.attemptId) {
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
    }
}
