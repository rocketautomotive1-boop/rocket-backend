import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';
import { PublicationLogService } from '../../marketplace/services/publication-log.service';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';

@Injectable()
export class ListingRemovalService {
    private readonly logger = new Logger(ListingRemovalService.name);

    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
        private readonly configCache: MarketplaceConfigCacheService,
        private readonly amqpConnection: AmqpConnection,
        private readonly publicationLogService: PublicationLogService,
        private readonly auth: MarketplaceAuthService,
    ) { }

    /**
     * Removes a listing. If the listing is published (has externalId),
     * dispatches an unpublish job to the marketplace via RabbitMQ.
     * Otherwise, deletes it directly from the database.
     */
    async removeListing(listingId: string, requesterId?: string): Promise<{
        removed?: boolean;
        queued?: boolean;
        jobId?: string;
        warning?: string;
    }> {
        const listing = await this.listingModel.findById(listingId).exec();
        if (!listing) {
            throw new NotFoundException(`Listing ${listingId} not found`);
        }

        // Simple case: listing was never published — just delete from DB
        if (!listing.externalId) {
            await this.listingModel.findByIdAndDelete(listingId).exec();
            this.logger.log(`Listing ${listingId} deleted (no externalId)`);
            return { removed: true };
        }

        // Published listing — need to unpublish from marketplace first
        const marketplace = await this.configCache.getById(String(listing.marketplaceId));
        if (!marketplace) {
            throw new NotFoundException(`Marketplace ${listing.marketplaceId} not found for listing ${listingId}`);
        }

        // Token via via única (accounts[], renova se preciso). Pode não existir.
        const activeToken = await this.auth
            .ensureValidToken(String(marketplace._id))
            .catch(() => null);
        if (!activeToken?.accessToken) {
            // No token — can't call marketplace API. Remove locally with warning.
            await this.listingModel.findByIdAndUpdate(listingId, {
                $set: { status: 'removed', publishingAt: null },
            }).exec();
            this.logger.warn(`Listing ${listingId} marked as removed locally — no active token for ${marketplace.name}`);
            return { removed: true, warning: `No active token for ${marketplace.name}. Listing removed locally but may still be live on the marketplace.` };
        }

        // Atomic lock — same pattern as publishListing
        const LOCK_TTL_MS = 2 * 60 * 1000;
        const lockExpiry = new Date(Date.now() - LOCK_TTL_MS);
        const claimed = await this.listingModel.findOneAndUpdate(
            {
                _id: listing._id,
                $or: [
                    { publishingAt: null },
                    { publishingAt: { $exists: false } },
                    { publishingAt: { $lt: lockExpiry } },
                ],
            },
            { $set: { publishingAt: new Date(), status: 'pending_removal' } },
        ).exec();

        if (!claimed) {
            throw new ConflictException(`Listing ${listingId} has an in-flight operation. Try again later.`);
        }

        const jobId = uuidv4();

        // Create publication attempt log
        const attempt = await this.publicationLogService.createAttempt(
            listing.productId.toString(),
            'ListingRemoval',
            [marketplace._id.toString()],
            { listingId, jobId, action: 'DELETE' },
        );

        // Build lightweight DELETE payload
        const payload: MarketplaceSyncPayload = {
            jobId,
            attemptId: attempt._id.toString(),
            marketplaceId: marketplace._id.toString(),
            listingId,
            externalId: listing.externalId,
            action: 'DELETE',
            metadata: { userId: requesterId },
            product: { _id: listing.productId.toString() },
            marketplace: {
                tag: marketplace.tag,
                credentials: {
                    accessToken: activeToken.accessToken,
                    refreshToken: activeToken.refreshToken,
                    expiresAt: activeToken.expiresAt ? new Date(activeToken.expiresAt).toISOString() : undefined,
                    ...activeToken.additionalData,
                },
                settings: marketplace.settings,
            },
            payload: {
                title: listing.title || '',
                description: '',
                price: 0,
                stock: 0,
                attributes: [],
                images: [],
                sku: '',
            },
        };

        // Dispatch to RabbitMQ
        const routingKey = `sync.${marketplace.tag.toLowerCase()}`;
        await this.amqpConnection.publish('rocket.marketplace.sync', routingKey, payload);

        this.logger.log(`Dispatched DELETE job ${jobId} for listing ${listingId} (externalId: ${listing.externalId}) to ${routingKey}`);
        return { queued: true, jobId };
    }
}
