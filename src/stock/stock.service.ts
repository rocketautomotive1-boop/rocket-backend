import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { StockRepository } from './stock.repository';
import { StockMoveInput, StockMoveSchema } from './dto/stock-move.dto';
import { StockMovementType } from './domain/movement-type';
import { computeBalanceDelta } from './domain/balance.calculator';
import { weightedAverageCost } from './domain/average-cost';

/**
 * The single entry point for ALL stock changes. Appends to the immutable ledger AND updates
 * the materialized balance in the same transaction — never one without the other. When given an
 * external session (e.g. OrderSyncPipeline) it joins that transaction → atomicity with the order.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly repo: StockRepository) {}

  async move(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    const dto = StockMoveSchema.parse(input);
    const productId = new Types.ObjectId(dto.productId);

    const session = externalSession ?? (await this.repo.getConnection().startSession());
    const ownSession = !externalSession;
    if (ownSession) session.startTransaction();

    try {
      // Idempotency: a reference is processed at most once.
      if (dto.reference && (await this.repo.referenceExists(dto.reference, session))) {
        this.logger.warn(`[Stock] ref ${dto.reference} already processed — skipping`);
        if (ownSession) await session.abortTransaction();
        return { movementId: '', lotId: '' };
      }

      const unitCost = Types.Decimal128.fromString(String(dto.unitCost ?? 0));
      const lot = await this.repo.findOrCreateLot(productId, dto.condition, unitCost, session);

      // Weighted-average cost on inbound with a positive cost.
      if (dto.type === StockMovementType.INBOUND && (dto.unitCost ?? 0) > 0) {
        const totals = await this.repo.balanceModel
          .aggregate([{ $match: { lotId: lot._id } }, { $group: { _id: '$lotId', onHand: { $sum: '$onHand' } } }])
          .session(session);
        const existingQty = totals[0]?.onHand ?? 0;
        const existingAvg = Number(lot.unitCost?.toString() ?? 0);
        const newAvg = weightedAverageCost(existingQty, existingAvg, dto.quantity, dto.unitCost!);
        lot.unitCost = Types.Decimal128.fromString(String(newAvg));
        await lot.save({ session });
      }

      const movement = await this.repo.appendMovement(
        {
          lotId: lot._id,
          productId,
          type: dto.type,
          quantity: dto.quantity,
          unitCost,
          condition: dto.condition,
          fromBoxId: dto.fromBoxId ? new Types.ObjectId(dto.fromBoxId) : undefined,
          toBoxId: dto.toBoxId ? new Types.ObjectId(dto.toBoxId) : undefined,
          orderId: dto.orderId ? new Types.ObjectId(dto.orderId) : undefined,
          reason: dto.reason,
          origin: dto.origin ? { type: dto.origin.type, location: dto.origin.location } : undefined,
          metadata: dto.reference ? { externalReference: dto.reference } : undefined,
        },
        session,
      );

      const delta = computeBalanceDelta(dto.type, dto.quantity);
      if (dto.type === StockMovementType.TRANSFER) {
        const from = dto.fromBoxId ? new Types.ObjectId(dto.fromBoxId) : null;
        const to = dto.toBoxId ? new Types.ObjectId(dto.toBoxId) : null;
        if (!from || !to) throw new BadRequestException('transfer exige fromBoxId e toBoxId');
        await this.repo.applyBalanceDelta(lot._id, productId, dto.condition, from, -dto.quantity, 0, session);
        await this.repo.applyBalanceDelta(lot._id, productId, dto.condition, to, dto.quantity, 0, session);
      } else {
        const boxId = dto.toBoxId
          ? new Types.ObjectId(dto.toBoxId)
          : dto.fromBoxId
            ? new Types.ObjectId(dto.fromBoxId)
            : null;
        await this.repo.applyBalanceDelta(lot._id, productId, dto.condition, boxId, delta.onHand, delta.reserved, session);
      }

      if (ownSession) await session.commitTransaction();
      return { movementId: movement._id.toString(), lotId: lot._id.toString() };
    } catch (err) {
      if (ownSession && session.inTransaction()) await session.abortTransaction();
      throw err;
    } finally {
      if (ownSession) await session.endSession();
    }
  }

  /**
   * Signed inventory correction. The ledger stays append-only — corrections are new
   * `adjustment` movements (never edits/deletes of past movements).
   */
  async adjust(
    input: {
      productId: string;
      quantity: number;
      condition?: 'new' | 'damaged' | 'used' | 'refurbished';
      reason?: string;
      reference?: string;
    },
    session?: ClientSession,
  ): Promise<{ movementId: string; lotId: string }> {
    return this.move(
      {
        productId: input.productId,
        type: StockMovementType.ADJUSTMENT,
        quantity: input.quantity,
        condition: input.condition ?? 'new',
        reason: input.reason,
        reference: input.reference,
      },
      session,
    );
  }
}
