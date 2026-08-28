import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { StoreListingStockBalanceModel, StoreListingStockBalanceDocument } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementDocument } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StockQueryPort, ProductStockSummary, ConditionBalance, LocationBalance } from './ports/stock-query.port';

/**
 * StockQueryPort implementation reading store-aware stock (StoreListing), replacing the legacy
 * aggregate-by-productId implementation (StockQueryService — stock_balances/stock_lots).
 *
 * These consumers have no storeId in their calling context (public search, checkout, bot, AI,
 * orchestrator — no authenticated user). Store is resolved as "the owning store of the product's
 * listing" via StoreListingPort.findAnyByProduct — the same resolution StockLedgerProvider already
 * uses for the order pipeline, and the same fact already relied on for publish routing (a product
 * has at most one StoreListing today). No cross-store aggregation, no fallback to a default store:
 * a product without any StoreListing yields zeroed stock, never an exception.
 */
@Injectable()
export class StoreListingStockQueryService implements StockQueryPort {
  constructor(
    @Inject(STORE_LISTING_PORT) private readonly storeListingPort: StoreListingPort,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly balanceModel: Model<StoreListingStockBalanceDocument>,
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly movementModel: Model<StoreListingStockMovementDocument>,
  ) {}

  async getProductStock(productId: string): Promise<ProductStockSummary> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return { productId, onHand: 0, reserved: 0, available: 0 };
    const { onHand, reserved, available } = await this.storeListingPort.getStockSummary(productId, storeId);
    return { productId, onHand, reserved, available };
  }

  async getByCondition(productId: string): Promise<ConditionBalance[]> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.storeListingPort.getStockByCondition(productId, storeId);
  }

  async getByLocation(productId: string): Promise<LocationBalance[]> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.storeListingPort.getStockByLocation(productId, storeId);
  }

  async getAvailableBulk(productIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!productIds.length) return map;
    const ids = productIds.map((id) => new Types.ObjectId(id));
    const rows = await this.balanceModel.aggregate([
      { $lookup: { from: 'store_listings', localField: 'storeListingId', foreignField: '_id', as: 'sl' } },
      { $unwind: '$sl' },
      { $match: { 'sl.productId': { $in: ids } } },
      { $group: { _id: '$sl.productId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    for (const r of rows) map.set(String(r._id), r.onHand - r.reserved);
    return map;
  }

  async getProductIdsWithMinStock(min: number): Promise<string[]> {
    const rows = await this.balanceModel.aggregate([
      { $lookup: { from: 'store_listings', localField: 'storeListingId', foreignField: '_id', as: 'sl' } },
      { $unwind: '$sl' },
      { $group: { _id: '$sl.productId', onHand: { $sum: '$onHand' } } },
      { $match: { onHand: { $gte: min } } },
      { $project: { _id: 1 } },
    ]);
    return rows.map((r) => String(r._id));
  }

  async getProductIdsWithMaxStock(max: number): Promise<string[]> {
    const rows = await this.balanceModel.aggregate([
      { $lookup: { from: 'store_listings', localField: 'storeListingId', foreignField: '_id', as: 'sl' } },
      { $unwind: '$sl' },
      { $group: { _id: '$sl.productId', onHand: { $sum: '$onHand' } } },
      { $match: { onHand: { $lte: max } } },
      { $project: { _id: 1 } },
    ]);
    return rows.map((r) => String(r._id));
  }

  async getProductCost(productId: string): Promise<number> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return 0;
    const { avgCost } = await this.storeListingPort.getStockSummary(productId, storeId);
    return avgCost;
  }

  async listMovements(productId: string, limit = 50) {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.storeListingPort.listStockMovements(productId, storeId, limit);
  }

  async getMovementStatistics(productId: string): Promise<Record<string, { count: number; quantity: number }>> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return {};
    return this.storeListingPort.getStockMovementStatistics(productId, storeId);
  }

  async getListingSnapshot(productId: string): Promise<{ condition: string } | null> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return null;
    const [last] = await this.storeListingPort.listStockMovements(productId, storeId, 1);
    return last ? { condition: last.condition } : null;
  }

  async referenceExists(reference: string): Promise<boolean> {
    const c = await this.movementModel.countDocuments({ 'metadata.externalReference': reference });
    return c > 0;
  }

  async findExistingReferences(references: string[]): Promise<string[]> {
    if (!references.length) return [];
    const rows = await this.movementModel
      .find({ 'metadata.externalReference': { $in: references } }, { 'metadata.externalReference': 1 })
      .lean()
      .exec();
    return rows.map((m: any) => m.metadata?.externalReference).filter(Boolean);
  }

  private async resolveStoreId(productId: string): Promise<string | null> {
    const listing = await this.storeListingPort.findAnyByProduct(productId);
    return listing ? String(listing.storeId) : null;
  }
}
