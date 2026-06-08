import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockRepository } from './stock.repository';
import {
  StockQueryPort,
  ProductStockSummary,
  ConditionBalance,
  LocationBalance,
} from './ports/stock-query.port';

@Injectable()
export class StockQueryService implements StockQueryPort {
  constructor(private readonly repo: StockRepository) {}

  async getProductStock(productId: string): Promise<ProductStockSummary> {
    const r = await this.repo.balanceModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: '$productId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    const onHand = r[0]?.onHand ?? 0;
    const reserved = r[0]?.reserved ?? 0;
    return { productId, onHand, reserved, available: onHand - reserved };
  }

  async getByCondition(productId: string): Promise<ConditionBalance[]> {
    return this.repo.balanceModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: '$condition', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, condition: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async getByLocation(productId: string): Promise<LocationBalance[]> {
    return this.repo.balanceModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: '$boxId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, boxId: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async getAvailableBulk(productIds: string[]): Promise<Map<string, number>> {
    const ids = productIds.map((id) => new Types.ObjectId(id));
    const rows = await this.repo.balanceModel.aggregate([
      { $match: { productId: { $in: ids } } },
      { $group: { _id: '$productId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    const map = new Map<string, number>();
    for (const r of rows) map.set(String(r._id), r.onHand - r.reserved);
    return map;
  }

  async getProductIdsWithMinStock(min: number): Promise<string[]> {
    const rows = await this.repo.balanceModel.aggregate([
      { $group: { _id: '$productId', onHand: { $sum: '$onHand' } } },
      { $match: { onHand: { $gte: min } } },
      { $project: { _id: 1 } },
    ]);
    return rows.map((r) => String(r._id));
  }

  async getProductCost(productId: string): Promise<number> {
    // Weighted-average cost across the product's lots, weighted by on-hand quantity.
    const rows = await this.repo.balanceModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: '$lotId', onHand: { $sum: '$onHand' } } },
      { $lookup: { from: 'stock_lots', localField: '_id', foreignField: '_id', as: 'lot' } },
      { $unwind: '$lot' },
      { $project: { onHand: 1, unitCost: { $toDouble: '$lot.unitCost' } } },
    ]);
    let totalQty = 0;
    let totalCost = 0;
    for (const r of rows) {
      const qty = Math.max(0, r.onHand);
      totalQty += qty;
      totalCost += qty * (r.unitCost ?? 0);
    }
    return totalQty > 0 ? totalCost / totalQty : 0;
  }

  async listMovements(productId: string, limit = 50) {
    const rows = await this.repo.movementModel
      .find({ productId: new Types.ObjectId(productId) })
      .sort({ date: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((m: any) => ({
      type: m.type,
      quantity: m.quantity,
      date: m.date,
      unitCost: m.unitCost != null ? Number(m.unitCost.toString()) : undefined,
      reason: m.reason,
    }));
  }

  async getMovementStatistics(productId: string): Promise<Record<string, { count: number; quantity: number }>> {
    const rows = await this.repo.movementModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: '$type', count: { $sum: 1 }, quantity: { $sum: '$quantity' } } },
    ]);
    const out: Record<string, { count: number; quantity: number }> = {};
    for (const r of rows) out[r._id] = { count: r.count, quantity: r.quantity };
    return out;
  }

  async getListingSnapshot(productId: string): Promise<{ condition: string } | null> {
    const last = await this.repo.movementModel
      .findOne({ productId: new Types.ObjectId(productId) })
      .sort({ date: -1 })
      .lean()
      .exec();
    return last ? { condition: (last as any).condition ?? 'new' } : null;
  }

  async referenceExists(reference: string): Promise<boolean> {
    const c = await this.repo.movementModel.countDocuments({ 'metadata.externalReference': reference });
    return c > 0;
  }

  async findExistingReferences(references: string[]): Promise<string[]> {
    if (!references.length) return [];
    const rows = await this.repo.movementModel
      .find({ 'metadata.externalReference': { $in: references } }, { 'metadata.externalReference': 1 })
      .lean()
      .exec();
    return rows.map((m: any) => m.metadata?.externalReference).filter(Boolean);
  }
}
