import { StoreListingModel } from '../schemas/store-listing.schema';
import { MarketplaceListingModel, MarketplaceListingStatus } from '../schemas/marketplace-listing.schema';
import { StockMovementType } from '../../stock/domain/movement-type';
import { StockCondition } from '../../stock/schemas/stock-lot.schema';

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
  recordStockMovement(params: {
    storeListingId: string;
    type: StockMovementType;
    quantity: number;
    condition?: StockCondition;
    unitCost?: string;
    lotId?: string;
    orderId?: string;
    fromBoxId?: string;
    toBoxId?: string;
    reason?: string;
  }): Promise<{ lotId: string; movementId: string }>;
}
