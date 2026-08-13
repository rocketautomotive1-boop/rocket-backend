import { StoreListingModel } from '../schemas/store-listing.schema';
import { MarketplaceListingModel, MarketplaceListingStatus } from '../schemas/marketplace-listing.schema';

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
  createOrGetStoreListing(productId: string, storeId: string): Promise<StoreListingModel & { id: string }>;
  upsertMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }>;
}
