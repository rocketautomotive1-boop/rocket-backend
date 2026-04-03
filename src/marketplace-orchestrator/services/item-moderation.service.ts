import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { ListingModel } from '../../listing/schemas/listing.schema';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';

@Injectable()
export class ItemModerationService {
    private readonly logger = new Logger(ItemModerationService.name);
    private readonly baseUrl = 'https://api.mercadolibre.com';

    constructor(
        @InjectModel(ListingModel.name)
        private readonly listingModel: Model<ListingModel>,
        private readonly authAdapter: MercadoLivreAuthAdapter,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Queries the ML API for items closed due to wrong category and
     * reconciles affected listings in the database.
     */
    async checkWrongCategoryItems(): Promise<void> {
        let mlUser: any;
        let token: string;

        try {
            mlUser = await this.authAdapter.me('Mercado Livre');
            token = await this.authAdapter.getValidToken('Mercado Livre');
        } catch (err) {
            this.logger.warn(`Skipping moderation check — ML auth unavailable: ${(err as Error).message}`);
            return;
        }

        const mlMarketplace = await this.marketplaceRegistry.findByTag('mercadolivre');
        if (!mlMarketplace) {
            this.logger.warn('Skipping moderation check — Mercado Livre marketplace not found in registry');
            return;
        }

        let closedItemIds: string[] = [];
        try {
            const response = await axios.get(
                `${this.baseUrl}/users/${mlUser.id}/items/search`,
                {
                    params: {
                        status: 'closed',
                        sub_status: 'wrong_category',
                    },
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
            closedItemIds = response.data?.results || [];
        } catch (err) {
            this.logger.error(`Failed to fetch closed items from ML: ${(err as Error).message}`);
            return;
        }

        if (!closedItemIds.length) {
            this.logger.debug('No items closed for wrong category');
            return;
        }

        this.logger.log(`Found ${closedItemIds.length} ML items closed for wrong category`);

        const affectedListings = await this.listingModel.find({
            marketplaceId: mlMarketplace._id,
            externalId: { $in: closedItemIds },
            status: { $nin: ['error', 'removed'] },
        });

        if (!affectedListings.length) {
            this.logger.debug('No new listings to flag — all already processed');
            return;
        }

        this.logger.log(`Processing ${affectedListings.length} affected listing(s)`);

        for (const listing of affectedListings) {
            await this.handleWrongCategoryListing(listing);
        }
    }

    private async handleWrongCategoryListing(listing: any): Promise<void> {
        const previousExternalId = listing.externalId;

        try {
            listing.status = 'error';
            listing.errorMessage = 'Finalizado pelo Mercado Livre — Categoria incorreta';
            listing.externalId = null;
            listing.synchronized = false;
            listing.publishingAt = null;
            listing.lastSyncAt = new Date();
            listing.marketplaceData = {
                ...listing.marketplaceData,
                closedReason: 'wrong_category',
                closedExternalId: previousExternalId,
                closedAt: new Date(),
            };

            await listing.save();

            this.logger.warn(
                `Listing ${listing._id} flagged: wrong category (was ${previousExternalId})`,
            );

            this.eventEmitter.emit('notification.send', {
                category: 'moderation',
                title: 'Anúncio finalizado — Categoria incorreta',
                body: `O Mercado Livre finalizou o anúncio ${previousExternalId} por estar em uma categoria incorreta. Corrija a categoria e republique.`,
                data: {
                    type: 'moderation',
                    marketplace: 'mercadolivre',
                    productId: listing.productId?.toString(),
                    listingId: listing._id?.toString(),
                    previousExternalId,
                    actionRoute: '/(drawer)/products/edit',
                },
                channels: ['push', 'websocket', 'persist'],
                severity: 'warning',
                deduplicationKey: `moderation:wrong_category:${previousExternalId}`,
            });
        } catch (err) {
            this.logger.error(
                `Failed to process listing ${listing._id}: ${(err as Error).message}`,
            );
        }
    }
}
