import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StockRepository } from './stock.repository';
import { MOVEMENT_EFFECT, StockMovementType } from './domain/movement-type';

/**
 * Audit/repair: re-aggregates the immutable ledger per (lot, box) using the same MOVEMENT_EFFECT
 * as the write path, and fixes any divergence in the materialized StockBalance. Also used by the
 * migration to materialize balances the first time. Divergences > 0 indicate a write-path bug.
 */
@Injectable()
export class StockReconcilerService {
  private readonly logger = new Logger(StockReconcilerService.name);
  private lastReport: { checked: number; fixed: number; at: Date | null } = { checked: 0, fixed: 0, at: null };

  constructor(private readonly repo: StockRepository) {}

  @Cron('0 0 3 * * *') // daily 03:00
  async reconcileAll(): Promise<{ checked: number; fixed: number }> {
    const onHandCase: any = {
      $switch: {
        branches: Object.values(StockMovementType).map((t) => ({
          case: { $eq: ['$type', t] },
          then: { $multiply: ['$quantity', MOVEMENT_EFFECT[t].onHand] },
        })),
        default: 0,
      },
    };
    const reservedCase: any = {
      $switch: {
        branches: Object.values(StockMovementType).map((t) => ({
          case: { $eq: ['$type', t] },
          then: { $multiply: ['$quantity', MOVEMENT_EFFECT[t].reserved] },
        })),
        default: 0,
      },
    };

    // Truth per (lot, box). Transfers carry both from/to; model the net per box by emitting
    // the box as toBox for inbound-like and fromBox for outbound-like. For non-transfer moves
    // the box is whichever of to/from is set.
    const truth = await this.repo.movementModel.aggregate([
      { $addFields: { box: { $ifNull: ['$toBoxId', '$fromBoxId'] } } },
      {
        $group: {
          _id: { lotId: '$lotId', boxId: '$box' },
          onHand: { $sum: onHandCase },
          reserved: { $sum: reservedCase },
          productId: { $first: '$productId' },
          condition: { $first: '$condition' },
        },
      },
    ]);

    let fixed = 0;
    for (const t of truth) {
      const res = await this.repo.balanceModel.updateOne(
        { lotId: t._id.lotId, boxId: t._id.boxId ?? null },
        {
          $set: { onHand: t.onHand, reserved: t.reserved },
          $setOnInsert: { productId: t.productId, condition: t.condition },
        },
        { upsert: true },
      );
      if (res.modifiedCount > 0 || res.upsertedCount > 0) fixed++;
    }

    this.lastReport = { checked: truth.length, fixed, at: new Date() };
    if (fixed > 0) this.logger.warn(`[StockReconcile] materialized/fixed ${fixed}/${truth.length} balance rows`);
    return { checked: truth.length, fixed };
  }

  getHealth() {
    return this.lastReport;
  }
}
