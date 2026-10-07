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

    /**
     * Resolve "a loja dona" via a StoreListing mais antiga do produto — hoje um produto tem no
     * máximo uma StoreListing, então isso é inequívoco. Se isso deixar de ser verdade (produto
     * vendido por múltiplas lojas), essa resolução passaria a escolher uma loja arbitrariamente
     * (a mais antiga) em vez de sinalizar a ambiguidade — loga um warning nesse caso para que o
     * cenário seja detectável em produção antes de virar um bug silencioso real.
     */
    async findStoreIdByProduct(productId: string): Promise<string | null> {
        const [doc, count] = await Promise.all([
            this.storeListingModel.findOne({ productId }).sort({ _id: 1 }).exec(),
            this.storeListingModel.countDocuments({ productId }),
        ]);
        if (count > 1) {
            this.logger.warn(
                `[StoreOwnerLookup] produto ${productId} tem ${count} StoreListings — resolvendo pela mais antiga, ambiguidade real não suportada ainda.`,
            );
        }
        return doc ? doc.storeId.toString() : null;
    }
}
