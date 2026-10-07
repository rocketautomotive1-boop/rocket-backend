import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceDocument } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementDocument } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StockQueryPort, StoreAwareStockQueryPort, ProductStockSummary, ConditionBalance, LocationBalance } from './ports/stock-query.port';

/**
 * StockQueryPort implementation reading store-aware stock (StoreListing) — the only stock store
 * since the legacy aggregate-by-productId collections (stock_balances/stock_lots/
 * stock_movements) were removed (Contract complete, 2026-08-29).
 *
 * These consumers have no storeId in their calling context (public search, checkout, bot, AI,
 * orchestrator — no authenticated user). Reads WITHOUT an explicit store see the WHOLE product:
 * they aggregate across ALL of the product's StoreListings (same semantics as getAvailableBulk and
 * getProductIdsWith{Min,Max}Stock). They used to resolve "the oldest StoreListing" instead, which
 * showed only one store of a multi-store product (incidente 7086768: 86 un. na loja nova, -48 na
 * antiga — a leitura mostrava só a antiga). This class deliberately does NOT depend on
 * STORE_LISTING_PORT nor on the owner-lookup port: injecting STORE_LISTING_PORT here used to create
 * a real DI instantiation cycle (StoreListingService depends on STOCK_QUERY_PORT for
 * getAllocationProducts, and this class is what STOCK_QUERY_PORT resolves to), which froze app boot
 * silently in production with no error.
 *
 * The store-aware methods below (getStoreStockSummary, getStoreStockByCondition,
 * getStoreStockByLocation, listStoreStockMovements, getStoreStockMovementStatistics — explicit
 * storeId, the authenticated inventory screen) used to live in StoreListingService/STORE_LISTING_PORT, reading
 * the exact same store_listing_stock_* collections this class already owns models for — moved
 * here 2026-08-29 as the other half of the cycle fix: that logic is Stock's, not StoreListing's,
 * and having it split across the two services was the structural reason the cycle existed at all.
 *
 * Store-aware reads (explicit storeId) stay isolated: no fallback to a default store, no inheriting
 * another store's stock. A product without any StoreListing yields zeroed stock, never an exception.
 */
@Injectable()
export class StoreListingStockQueryService implements StockQueryPort, StoreAwareStockQueryPort {
  constructor(
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly balanceModel: Model<StoreListingStockBalanceDocument>,
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly movementModel: Model<StoreListingStockMovementDocument>,
  ) {}

  async getProductStock(productId: string): Promise<ProductStockSummary> {
    const ids = await this.storeListingIds(productId);
    const { onHand, reserved } = await this.sumBalances(ids);
    return { productId, onHand, reserved, available: onHand - reserved };
  }

  async getProductOnHandAcrossStores(productId: string): Promise<number> {
    return (await this.getProductStock(productId)).onHand;
  }

  async getByCondition(productId: string): Promise<ConditionBalance[]> {
    return this.balancesBy(await this.storeListingIds(productId), '$condition', 'condition');
  }

  async getByLocation(productId: string): Promise<LocationBalance[]> {
    return this.balancesBy(await this.storeListingIds(productId), '$boxId', 'boxId');
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

  /**
   * Full scan de store_listing_stock_balances (sem $match de entrada) — estrutural, não um bug:
   * "todos os produtos que satisfazem X" não tem como filtrar antes do $group. Índice de
   * auditoria (2026-08-29, produção): 2.648 docs em store_listing_stock_balances, scan completo
   * é da ordem de poucos ms nesse volume. Reavaliar (paginação, ou materializar um agregado por
   * produto) se a coleção crescer pra ordem de centenas de milhares — hoje é prematuro.
   */
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

  /** Ver comentário de getProductIdsWithMinStock — mesmo padrão estrutural de full scan. */
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
    return this.avgCost(await this.storeListingIds(productId));
  }

  async listMovements(productId: string, limit = 50) {
    const storeListings = await this.storeListingModel.find({ productId }).select('_id storeId').lean().exec();
    return this.fetchMovements(storeListings, limit);
  }

  async getMovementStatistics(productId: string): Promise<Record<string, { count: number; quantity: number }>> {
    return this.movementStats(await this.storeListingIds(productId));
  }

  async getListingSnapshot(productId: string): Promise<{ condition: string } | null> {
    const [last] = await this.listMovements(productId, 1);
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
    const ids = [storeListingId];
    const { onHand, reserved } = await this.sumBalances(ids);
    return { onHand, reserved, available: onHand - reserved, avgCost: await this.avgCost(ids) };
  }

  async getStoreStockByCondition(productId: string, storeId: string): Promise<ConditionBalance[]> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];
    return this.balancesBy([storeListingId], '$condition', 'condition');
  }

  async getStoreStockByLocation(productId: string, storeId: string): Promise<LocationBalance[]> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];
    return this.balancesBy([storeListingId], '$boxId', 'boxId');
  }

  async listStoreStockMovements(
    productId: string,
    storeId: string,
    limit = 50,
  ): Promise<Array<{ id: string; type: string; quantity: number; date: Date; unitCost?: number; salePrice?: number; condition: string; reason?: string; storeId?: string }>> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return [];
    return this.fetchMovements([{ _id: storeListingId, storeId }], limit);
  }

  async getStoreStockMovementStatistics(
    productId: string,
    storeId: string,
  ): Promise<Record<string, { count: number; quantity: number }>> {
    const storeListingId = await this.resolveStoreListingId(productId, storeId);
    if (!storeListingId) return {};
    return this.movementStats([storeListingId]);
  }

  // ── helpers compartilhados: operam sobre UM OU VÁRIOS storeListingIds ────────────────────────

  private async storeListingIds(productId: string): Promise<Types.ObjectId[]> {
    const rows = await this.storeListingModel.find({ productId }).select('_id').lean().exec();
    return rows.map((r: any) => new Types.ObjectId(String(r._id)));
  }

  private async sumBalances(ids: Types.ObjectId[]): Promise<{ onHand: number; reserved: number }> {
    if (!ids.length) return { onHand: 0, reserved: 0 };
    const rows = await this.balanceModel.aggregate([
      { $match: { storeListingId: { $in: ids } } },
      { $group: { _id: null, onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    return { onHand: rows[0]?.onHand ?? 0, reserved: rows[0]?.reserved ?? 0 };
  }

  private async balancesBy(ids: Types.ObjectId[], groupBy: string, field: 'condition'): Promise<ConditionBalance[]>;
  private async balancesBy(ids: Types.ObjectId[], groupBy: string, field: 'boxId'): Promise<LocationBalance[]>;
  private async balancesBy(ids: Types.ObjectId[], groupBy: string, field: 'condition' | 'boxId'): Promise<any[]> {
    if (!ids.length) return [];
    return this.balanceModel.aggregate([
      { $match: { storeListingId: { $in: ids } } },
      { $group: { _id: groupBy, onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, [field]: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  /** Custo médio ponderado pela quantidade (>0) de cada lote — pode abranger lotes de várias lojas. */
  private async avgCost(ids: Types.ObjectId[]): Promise<number> {
    if (!ids.length) return 0;
    const costRows = await this.balanceModel.aggregate([
      { $match: { storeListingId: { $in: ids } } },
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
    return totalQty > 0 ? totalCost / totalQty : 0;
  }

  private async fetchMovements(
    storeListings: Array<{ _id: any; storeId?: any }>,
    limit: number,
  ): Promise<Array<{ id: string; type: string; quantity: number; date: Date; unitCost?: number; salePrice?: number; condition: string; reason?: string; storeId?: string }>> {
    if (!storeListings.length) return [];
    const storeBySl = new Map(storeListings.map((sl) => [String(sl._id), sl.storeId != null ? String(sl.storeId) : undefined]));
    const rows = await this.movementModel
      .find({ storeListingId: { $in: storeListings.map((sl) => new Types.ObjectId(String(sl._id))) } })
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
      storeId: storeBySl.get(String(m.storeListingId)),
    }));
  }

  private async movementStats(ids: Types.ObjectId[]): Promise<Record<string, { count: number; quantity: number }>> {
    if (!ids.length) return {};
    const rows = await this.movementModel.aggregate([
      { $match: { storeListingId: { $in: ids } } },
      { $group: { _id: '$type', count: { $sum: 1 }, quantity: { $sum: '$quantity' } } },
    ]);
    const out: Record<string, { count: number; quantity: number }> = {};
    for (const r of rows) out[r._id] = { count: r.count, quantity: r.quantity };
    return out;
  }

  private async resolveStoreListingId(productId: string, storeId: string): Promise<Types.ObjectId | null> {
    const doc = await this.storeListingModel.findOne({ productId, storeId }).exec();
    return doc ? new Types.ObjectId(String((doc as any)._id)) : null;
  }
}
