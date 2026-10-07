import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import { StoreOwnerLookupPort, SaleStoreQuery, StoreResolution } from './ports/store-owner-lookup.port';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';

@Injectable()
export class StoreOwnerLookupService implements StoreOwnerLookupPort {
    private readonly logger = new Logger(StoreOwnerLookupService.name);

    constructor(
        @InjectModel(StoreListingModel.name)
        private readonly storeListingModel: Model<StoreListingDocument>,
        @InjectModel(ListingModel.name)
        private readonly listingModel: Model<ListingDocument>,
    ) { }

    async resolveStoreForSale(query: SaleStoreQuery): Promise<StoreResolution> {
        if (query.marketplaceId && query.listingExternalId) {
            const listing = await this.listingModel
                .findOne({ marketplaceId: query.marketplaceId, externalId: query.listingExternalId, productId: query.productId })
                .select('storeId')
                .lean()
                .exec();
            if (listing?.storeId) return { storeId: String(listing.storeId), via: 'listing' };
        }

        const storeListings = await this.storeListingModel
            .find({ productId: query.productId })
            .select('storeId')
            .sort({ _id: 1 })
            .lean()
            .exec();
        if (storeListings.length === 1) return { storeId: String(storeListings[0].storeId), via: 'single' };
        if (storeListings.length === 0) return { storeId: null, via: 'none' };

        this.logger.error(
            `[StoreOwnerLookup] produto ${query.productId} tem ${storeListings.length} lojas e o anúncio ` +
            `${query.listingExternalId ?? '∅'} (mkt ${query.marketplaceId ?? '∅'}) não resolveu a loja — venda NÃO atribuída (ambígua).`,
        );
        return { storeId: null, via: 'ambiguous' };
    }
}
