import { StoreListingModel } from '../schemas/store-listing.schema';
import { MarketplaceListingModel, MarketplaceListingStatus } from '../schemas/marketplace-listing.schema';
import { StoreListingWarehouseModel } from '../schemas/store-listing-warehouse.schema';
import {
  DamagedUnitCondition,
  DamagedUnitStatus,
  StoreListingDamagedUnitModel,
} from '../schemas/store-listing-damaged-unit.schema';
import { StoreListingDamagedAllocationModel } from '../schemas/store-listing-damaged-allocation.schema';
import { AllocationModel } from '../../product/schemas/allocation.schema';
import { BoxModel } from '../../product/schemas/box.schema';
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

  createWarehouse(
    storeId: string,
    name: string,
    address?: string,
  ): Promise<StoreListingWarehouseModel & { id: string }>;
  listWarehouses(storeId: string): Promise<Array<StoreListingWarehouseModel & { id: string }>>;
  findWarehouseById(warehouseId: string): Promise<(StoreListingWarehouseModel & { id: string }) | null>;

  /**
   * Allocations (localização física dentro de um depósito) da loja do usuário
   * autenticado. warehouseId precisa pertencer à mesma loja — validado aqui,
   * mesmo padrão de allocateDamagedUnit. storeId nunca é denormalizado em
   * AllocationModel; é sempre obtido por join em StoreListingWarehouseModel.
   */
  createAllocation(
    storeId: string,
    params: { warehouseId: string; locationPath: string; metadata?: Record<string, any>; available?: boolean },
  ): Promise<AllocationModel & { id: string }>;
  listAllocations(storeId: string): Promise<Array<AllocationModel & { id: string }>>;
  getAllocation(storeId: string, allocationId: string): Promise<AllocationModel & { id: string }>;
  /** Produtos de todos os boxes de uma allocation, agrupados por box, com join de estoque/preço. */
  getAllocationProducts(
    storeId: string,
    allocationId: string,
  ): Promise<{
    allocation: AllocationModel & { id: string };
    boxes: any[];
    totals: { totalBoxes: number; totalItems: number; totalValue: number };
  }>;
  /**
   * Escaneia QR de allocation: ObjectId cru resolve por id; caso contrário parseia locationPath
   * (puro ou formato ALLOC;PATH=...). dryRun=true nunca cria, só pré-visualiza o parse.
   */
  scanAllocation(
    storeId: string,
    qr: string,
    dryRun: boolean,
  ): Promise<{
    allocation: (AllocationModel & { id: string }) | null;
    isNew: boolean;
    parsed?: { locationPath?: string; metadata?: Record<string, any> };
  }>;

  /**
   * Boxes (subdocumento de AllocationModel.boxes[]) da loja do usuário
   * autenticado. Mesmo padrão de allocations: storeId nunca denormalizado,
   * sempre resolvido via allocation.warehouseId -> StoreListingWarehouseModel.
   * NotFoundException (não Forbidden) quando o box/allocation existe mas é de
   * outra loja — não confirmamos a existência do recurso a quem não tem acesso.
   */
  createBox(
    storeId: string,
    allocationId: string,
    params: { code?: string; description?: string },
  ): Promise<BoxModel & { id: string; allocationId: string }>;
  listBoxes(storeId: string): Promise<Array<BoxModel & { id: string; allocationId: string; warehouseId: string }>>;
  getBox(storeId: string, boxId: string): Promise<BoxModel & { id: string; allocationId: string; warehouseId: string }>;
  getBoxByCode(storeId: string, code: string): Promise<BoxModel & { id: string; allocationId: string; warehouseId: string }>;
  updateBox(
    storeId: string,
    boxId: string,
    patch: { code?: string; description?: string },
  ): Promise<BoxModel & { id: string }>;
  removeBox(storeId: string, boxId: string): Promise<void>;
  getBoxProducts(
    storeId: string,
    boxId: string,
  ): Promise<{ box: BoxModel & { id: string }; products: any[] }>;
  getBoxProductsByCode(
    storeId: string,
    code: string,
  ): Promise<{ box: BoxModel & { id: string }; products: any[] }>;
  addProductToBox(storeId: string, boxId: string, productId: string): Promise<BoxModel & { id: string }>;
  removeProductFromBox(storeId: string, boxId: string, productId: string): Promise<BoxModel & { id: string }>;
  linkBoxToAllocation(
    storeId: string,
    boxId: string,
    targetAllocationId: string,
  ): Promise<BoxModel & { id: string; allocationId: string }>;
  /** Escaneia QR de box: liga a um box existente na allocation ou cria um novo com o código lido. */
  scanBox(
    storeId: string,
    qr: string,
    allocationId: string,
  ): Promise<{ box: BoxModel & { id: string; allocationId: string }; isNew: boolean }>;
  /** Shape compatível com o antigo BoxService.getBoxItemsByProductId: [{ box: {...boxObj, allocation}, productId }]. */
  getBoxesByProduct(storeId: string, productId: string): Promise<any[]>;

  markUnitsAsDamaged(params: {
    productId: string;
    storeId: string;
    sourceCondition: 'new';
    quantity: number;
    targetCondition: DamagedUnitCondition;
    reason?: string;
  }): Promise<{ unitIds: string[] }>;

  updateDamagedUnit(
    unitId: string,
    storeId: string,
    patch: { photos?: string[]; damageNotes?: string; price?: number },
  ): Promise<StoreListingDamagedUnitModel & { id: string }>;
  allocateDamagedUnit(
    unitId: string,
    storeId: string,
    warehouseId: string,
    position?: string,
  ): Promise<StoreListingDamagedAllocationModel & { id: string }>;
  isDamagedUnitPublishable(unitId: string): Promise<boolean>;
  listDamagedUnits(
    productId: string,
    storeId: string,
    status?: DamagedUnitStatus,
  ): Promise<Array<StoreListingDamagedUnitModel & { id: string }>>;
}
