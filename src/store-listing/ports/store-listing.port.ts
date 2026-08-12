import { StoreListingModel } from '../schemas/store-listing.schema';
import { MarketplaceListingModel } from '../schemas/marketplace-listing.schema';

export const STORE_LISTING_PORT = Symbol('STORE_LISTING_PORT');

export interface StoreListingPort {
  findByProductAndStore(
    productId: string,
    storeId: string,
  ): Promise<(StoreListingModel & { id: string }) | null>;
  findById(storeListingId: string): Promise<(StoreListingModel & { id: string }) | null>;
  getMarketplaceListings(
    storeListingId: string,
  ): Promise<Array<MarketplaceListingModel & { id: string }>>;
}
