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
          // Snapshot do preço de venda vigente (NUNCA no unitCost — que é custo do lote).
          metadata:
            dto.reference != null || dto.salePrice != null
              ? {
                  ...(dto.reference != null ? { externalReference: dto.reference } : {}),
                  ...(dto.salePrice != null ? { salePrice: dto.salePrice } : {}),
                }
              : undefined,
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

  /**
   * "Delete" a movement → append a compensating adjustment that cancels its balance effect.
   * The ledger stays append-only (audit/fiscal correctness). Returns the compensating movement id.
   */
  async reverseMovement(movementId: string): Promise<{ movementId: string; lotId: string }> {
    const original = await this.repo.movementModel.findById(movementId).lean().exec();
    if (!original) throw new BadRequestException(`Movement ${movementId} not found`);
    const delta = computeBalanceDelta((original as any).type, (original as any).quantity);
    // Compensate the net onHand effect with an adjustment of the opposite sign.
    return this.adjust({
      productId: String((original as any).productId),
      quantity: -delta.onHand,
      condition: (original as any).condition ?? 'new',
      reason: `Estorno do movimento ${movementId}`,
    });
  }

  /**
   * "Edit" a movement's quantity → append an adjustment for the difference (no destructive edit).
   * `newQuantity` is the intended absolute quantity of the original movement.
   */
  async editMovementViaAdjustment(movementId: string, newQuantity: number): Promise<{ movementId: string; lotId: string }> {
    const original = await this.repo.movementModel.findById(movementId).lean().exec();
    if (!original) throw new BadRequestException(`Movement ${movementId} not found`);
    const oldDelta = computeBalanceDelta((original as any).type, (original as any).quantity);
    const newDelta = computeBalanceDelta((original as any).type, newQuantity);
    const diff = newDelta.onHand - oldDelta.onHand;
    return this.adjust({
      productId: String((original as any).productId),
      quantity: diff,
      condition: (original as any).condition ?? 'new',
      reason: `Correção do movimento ${movementId} (qtd ${(original as any).quantity} → ${newQuantity})`,
    });
  }
}
