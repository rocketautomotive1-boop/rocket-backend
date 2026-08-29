import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { STORE_OWNER_LOOKUP_PORT, StoreOwnerLookupPort } from '../store-listing/ports/store-owner-lookup.port';
import { StoreListingModel, StoreListingDocument } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceDocument } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementDocument } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StockQueryPort, StoreAwareStockQueryPort, ProductStockSummary, ConditionBalance, LocationBalance } from './ports/stock-query.port';

/**
 * StockQueryPort implementation reading store-aware stock (StoreListing), replacing the legacy
 * aggregate-by-productId implementation (StockQueryService — stock_balances/stock_lots).
 *
 * These consumers have no storeId in their calling context (public search, checkout, bot, AI,
 * orchestrator — no authenticated user). Store is resolved as "the owning store of the product's
 * listing" via STORE_OWNER_LOOKUP_PORT (StoreOwnerLookupService), a small leaf port — never
 * STORE_LISTING_PORT: injecting that here used to create a real DI instantiation cycle
 * (StoreListingService depends on STOCK_QUERY_PORT for getAllocationProducts, and this class is
 * what STOCK_QUERY_PORT resolves to), which froze app boot silently in production with no error.
 *
 * The store-aware methods below (getStoreStockSummary, getStoreStockByCondition,
 * getStoreStockByLocation, listStoreStockMovements, getStoreStockMovementStatistics — explicit
 * storeId, the authenticated inventory screen) used to live in StoreListingService/STORE_LISTING_PORT, reading
 * the exact same store_listing_stock_* collections this class already owns models for — moved
 * here 2026-08-29 as the other half of the cycle fix: that logic is Stock's, not StoreListing's,
 * and having it split across the two services was the structural reason the cycle existed at all.
 *
 * A product has at most one StoreListing today; no cross-store aggregation, no fallback to a
 * default store: a product without any StoreListing yields zeroed stock, never an exception.
 */
@Injectable()
export class StoreListingStockQueryService implements StockQueryPort, StoreAwareStockQueryPort {
  constructor(
    @Inject(STORE_OWNER_LOOKUP_PORT) private readonly storeOwnerLookup: StoreOwnerLookupPort,
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly balanceModel: Model<StoreListingStockBalanceDocument>,
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly movementModel: Model<StoreListingStockMovementDocument>,
  ) {}

  async getProductStock(productId: string): Promise<ProductStockSummary> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return { productId, onHand: 0, reserved: 0, available: 0 };
    const { onHand, reserved, available } = await this.getStoreStockSummary(productId, storeId);
    return { productId, onHand, reserved, available };
  }

  async getByCondition(productId: string): Promise<ConditionBalance[]> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.getStoreStockByCondition(productId, storeId);
  }

  async getByLocation(productId: string): Promise<LocationBalance[]> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.getStoreStockByLocation(productId, storeId);
  }

  async getAvailableBulk(productIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!productIds.length) return map;
    const ids = productIds.map((id) => new Types.ObjectId(id));
    // Starts from store_listings (filtered by productId — small, indexed) and looks up into
    // store_listing_stock_balances from there, instead of the other way around: a $lookup
    // rooted in the balances collection would join every balance document before filtering,
    // scanning the whole collection on every paginated search request.
    const rows = await this.storeListingModel.aggregate([
      { $match: { productId: { $in: ids } } },
      { $lookup: { from: 'store_listing_stock_balances', localField: '_id', foreignField: 'storeListingId', as: 'balances' } },
      { $unwind: '$balances' },
      {
        $group: {
          _id: '$productId',
          onHand: { $sum: '$balances.onHand' },
          reserved: { $sum: '$balances.reserved' },
        },
      },
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
    const { avgCost } = await this.getStoreStockSummary(productId, storeId);
    return avgCost;
  }

  async listMovements(productId: string, limit = 50) {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return [];
    return this.listStoreStockMovements(productId, storeId, limit);
  }

  async getMovementStatistics(productId: string): Promise<Record<string, { count: number; quantity: number }>> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return {};
    return this.getStoreStockMovementStatistics(productId, storeId);
  }

  async getListingSnapshot(productId: string): Promise<{ condition: string } | null> {
    const storeId = await this.resolveStoreId(productId);
    if (!storeId) return null;
    const [last] = await this.listStoreStockMovements(productId, storeId, 1);
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

  async getStoreStockSummary(
    productId: string,
    storeId: string,
  ): Promise<{ onHand: number; reserved: number; available: number; avgCost: number }> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return { onHand: 0, reserved: 0, available: 0, avgCost: 0 };

    const balances = await this.balanceModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$storeListingId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    const onHand = balances[0]?.onHand ?? 0;
    const reserved = balances[0]?.reserved ?? 0;

    const costRows = await this.balanceModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$lotId', onHand: { $sum: '$onHand' } } },
      { $lookup: { from: 'store_listing_stock_lots', localField: '_id', foreignField: '_id', as: 'lot' } },
      { $unwind: '$lot' },
      { $project: { onHand: 1, unitCost: { $toDouble: '$lot.unitCost' } } },
    ]);
    let totalQty = 0;
    let totalCost = 0;
    for (const r of costRows) {
      const qty = Math.max(0, r.onHand);
      totalQty += qty;
      totalCost += qty * (r.unitCost ?? 0);
    }
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    return { onHand, reserved, available: onHand - reserved, avgCost };
  }

  async getStoreStockByCondition(productId: string, storeId: string): Promise<ConditionBalance[]> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];

    return this.balanceModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$condition', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, condition: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async getStoreStockByLocation(productId: string, storeId: string): Promise<LocationBalance[]> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];

    return this.balanceModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$boxId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, boxId: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async listStoreStockMovements(
    productId: string,
    storeId: string,
    limit = 50,
  ): Promise<Array<{ id: string; type: string; quantity: number; date: Date; unitCost?: number; salePrice?: number; condition: string; reason?: string }>> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];

    const rows = await this.movementModel
      .find({ storeListingId })
      .sort({ date: -1 })
      .limit(limit)
      .lean()
      .exec();

    return rows.map((m: any) => ({
      id: String(m._id),
      type: m.type,
      quantity: m.quantity,
      date: m.date,
      unitCost: m.unitCost != null ? Number(m.unitCost.toString()) : undefined,
      salePrice: m.metadata?.salePrice != null ? Number(m.metadata.salePrice) : undefined,
      condition: m.condition ?? 'new',
      reason: m.reason,
    }));
  }

  async getStoreStockMovementStatistics(
    productId: string,
    storeId: string,
  ): Promise<Record<string, { count: number; quantity: number }>> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return {};

    const rows = await this.movementModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$type', count: { $sum: 1 }, quantity: { $sum: '$quantity' } } },
    ]);
    const out: Record<string, { count: number; quantity: number }> = {};
    for (const r of rows) out[r._id] = { count: r.count, quantity: r.quantity };
    return out;
  }

  private async resolveStoreId(productId: string): Promise<string | null> {
    return this.storeOwnerLookup.findStoreIdByProduct(productId);
  }

  private async resolveStoreListingId(productId: string, storeId: string): Promise<Types.ObjectId | null> {
    const doc = await this.storeListingModel.findOne({ productId, storeId }).exec();
    return doc ? new Types.ObjectId(String((doc as any)._id)) : null;
  }
}
