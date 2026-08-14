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
  /**
   * Find ANY existing StoreListing for a product, regardless of store. Used by
   * dual-write callers (e.g. StockService) that have no store context of their
   * own and want to prefer an existing listing over creating one in a fallback
   * store. Deterministic on ties (oldest first) — a product is expected to have
   * at most one StoreListing today, but this must not silently pick a random one.
   */
  findAnyByProduct(productId: string): Promise<(StoreListingModel & { id: string }) | null>;
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

  /**
   * Leitura store-aware do saldo (Fase 4, sub-projeto 3) — usada só pela tela de inventário,
   * que tem storeId real do usuário autenticado. Sem StoreListing para (productId, storeId) →
   * zero, sem fallback pra outra loja (decisão explícita: uma loja sem estoque próprio nunca
   * herda o saldo de outra).
   */
  getStockSummary(
    productId: string,
    storeId: string,
  ): Promise<{ onHand: number; reserved: number; available: number; avgCost: number }>;
  getStockByCondition(
    productId: string,
    storeId: string,
  ): Promise<Array<{ condition: StockCondition; onHand: number; reserved: number }>>;
  getStockByLocation(
    productId: string,
    storeId: string,
  ): Promise<Array<{ boxId: string | null; onHand: number; reserved: number }>>;
}
