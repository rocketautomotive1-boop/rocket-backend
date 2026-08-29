import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import { StockMoveInput, StockMoveSchema } from './dto/stock-move.dto';
import { StockMovementType } from '../stock-shared/movement-type';
import { computeBalanceDelta } from '../stock-shared/balance-math';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { StockWritePort } from './ports/stock-write.port';

/**
 * The single entry point for ALL stock changes. store_listing_stock_* (StoreListing) é a única
 * fonte de verdade — Contract completo (2026-08-29): o legado (stock_balances/stock_lots/
 * stock_movements) foi removido após validação em produção do dual-write invertido. Ver
 * docs/superpowers/specs/2026-08-28-stock-contract-legacy-cutover-design.md e
 * docs/superpowers/specs/2026-08-29-stock-write-cutover-design.md.
 */
@Injectable()
export class StockService implements StockWritePort {
  private readonly logger = new Logger(StockService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(STORE_LISTING_PORT)
    private readonly storeListingPort: StoreListingPort,
  ) {}

  async move(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    if (externalSession) {
      return this.moveOnce(input, externalSession);
    }
    return this.moveWithRetry(input);
  }

  private async moveWithRetry(input: StockMoveInput): Promise<{ movementId: string; lotId: string }> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.moveOnce(input);
      } catch (err: any) {
        const isTransient = err?.errorLabels?.includes('TransientTransactionError');
        if (!isTransient || attempt === maxAttempts) throw err;
        this.logger.warn(`[Stock] transient write conflict on move() — retry ${attempt}/${maxAttempts}`);
      }
    }
    throw new Error('unreachable');
  }

  private async moveOnce(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    const dto = StockMoveSchema.parse(input);

    const session = externalSession ?? (await this.connection.startSession());
    const ownSession = !externalSession;
    if (ownSession) session.startTransaction();

    try {
      // Idempotency: a reference is processed at most once. Checked against the PRIMARY store
      // (store_listing_stock_movements), not the legacy mirror.
      if (dto.reference && (await this.storeListingPort.referenceExists(dto.reference, session))) {
        this.logger.warn(`[Stock] ref ${dto.reference} already processed — skipping`);
        if (ownSession) await session.abortTransaction();
        return { movementId: '', lotId: '' };
      }

      const storeListing = await this.storeListingPort.createOrGetStoreListing(dto.productId, dto.storeId);
      const unitCostStr = dto.unitCost != null ? String(dto.unitCost) : undefined;

      let result: { lotId: string; movementId: string };
      if (dto.type === StockMovementType.TRANSFER) {
        if (!dto.fromBoxId || !dto.toBoxId) throw new BadRequestException('transfer exige fromBoxId e toBoxId');
        // TRANSFER nets to {onHand:0, reserved:0} — mirror it as two signed ADJUSTMENT writes
        // (debit at fromBoxId, credit at toBoxId), same math as computeBalanceDelta expects.
        await this.storeListingPort.recordStockMovement(
          {
            storeListingId: storeListing.id,
            type: StockMovementType.ADJUSTMENT,
            quantity: -dto.quantity,
            condition: dto.condition,
            unitCost: unitCostStr,
            fromBoxId: dto.fromBoxId,
            reason: dto.reason,
          },
          session,
        );
        result = await this.storeListingPort.recordStockMovement(
          {
            storeListingId: storeListing.id,
            type: StockMovementType.ADJUSTMENT,
            quantity: dto.quantity,
            condition: dto.condition,
            unitCost: unitCostStr,
            toBoxId: dto.toBoxId,
            reason: dto.reason,
            reference: dto.reference,
            salePrice: dto.salePrice,
          },
          session,
        );
      } else {
        result = await this.storeListingPort.recordStockMovement(
          {
            storeListingId: storeListing.id,
            type: dto.type,
            quantity: dto.quantity,
            condition: dto.condition,
            unitCost: unitCostStr,
            fromBoxId: dto.fromBoxId,
            toBoxId: dto.toBoxId,
            orderId: dto.orderId,
            reason: dto.reason,
            reference: dto.reference,
            salePrice: dto.salePrice,
          },
          session,
        );
      }

      if (ownSession) await session.commitTransaction();
      return result;
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
      storeId: string;
      quantity: number;
      condition?: 'new' | 'damaged' | 'used' | 'refurbished';
      reason?: string;
      reference?: string;
      toBoxId?: string;
    },
    session?: ClientSession,
  ): Promise<{ movementId: string; lotId: string }> {
    return this.move(
      {
        productId: input.productId,
        storeId: input.storeId,
        type: StockMovementType.ADJUSTMENT,
        quantity: input.quantity,
        condition: input.condition ?? 'new',
        reason: input.reason,
        reference: input.reference,
        toBoxId: input.toBoxId,
      },
      session,
    );
  }

  /**
   * "Delete" a movement → append a compensating adjustment that cancels its balance effect.
   * The ledger stays append-only (audit/fiscal correctness). Returns the compensating movement id.
   *
   * movementId agora é o _id de um documento em store_listing_stock_movements (Contract):
   * StoreListing é a fonte primária, então "o movimento original" vive lá — ver
   * StoreListingPort.findMovementById.
   */
  async reverseMovement(movementId: string, fallbackStoreId?: string): Promise<{ movementId: string; lotId: string }> {
    const original = await this.storeListingPort.findMovementById(movementId);
    if (!original) throw new BadRequestException(`Movement ${movementId} not found`);
    const storeId = original.storeId ?? fallbackStoreId;
    if (!storeId) {
      throw new BadRequestException(
        `Movimento ${movementId} não tem loja associada e nenhum storeId foi informado para o estorno.`,
      );
    }
    const delta = computeBalanceDelta(original.type, original.quantity);
    const originalBoxId = original.toBoxId ?? original.fromBoxId;
    // Compensate the net onHand effect with an adjustment of the opposite sign, in the same box.
    return this.adjust({
      productId: original.productId,
      storeId,
      quantity: -delta.onHand,
      condition: original.condition ?? 'new',
      reason: `Estorno do movimento ${movementId}`,
      toBoxId: originalBoxId,
    });
  }

  /**
   * Correct total on-hand for a (product, condition) to an absolute target — the UI-facing
   * "o estoque real é X" flow. Computes the diff against the current materialized balance and
   * posts a single signed adjustment; a no-op (target === current) creates nothing.
   */
  async correctTo(input: {
    productId: string;
    storeId: string;
    targetQuantity: number;
    condition?: 'new' | 'damaged' | 'used' | 'refurbished';
  }): Promise<{ movementId: string; lotId: string } | null> {
    const condition = input.condition ?? 'new';
    const current = await this.storeListingPort.getConditionOnHand(input.productId, input.storeId, condition);
    const diff = input.targetQuantity - current;
    if (diff === 0) return null;
    return this.adjust({
      productId: input.productId,
      storeId: input.storeId,
      quantity: diff,
      condition,
      reason: `Correção de estoque: ${current} → ${input.targetQuantity}`,
    });
  }

  /**
   * "Edit" a movement's quantity → append an adjustment for the difference (no destructive edit).
   * `newQuantity` is the intended absolute quantity of the original movement.
   */
  async editMovementViaAdjustment(movementId: string, newQuantity: number, fallbackStoreId?: string): Promise<{ movementId: string; lotId: string }> {
    const original = await this.storeListingPort.findMovementById(movementId);
    if (!original) throw new BadRequestException(`Movement ${movementId} not found`);
    const storeId = original.storeId ?? fallbackStoreId;
    if (!storeId) {
      throw new BadRequestException(
        `Movimento ${movementId} não tem loja associada e nenhum storeId foi informado para a correção.`,
      );
    }
    const oldDelta = computeBalanceDelta(original.type, original.quantity);
    const newDelta = computeBalanceDelta(original.type, newQuantity);
    const diff = newDelta.onHand - oldDelta.onHand;
    const originalBoxId = original.toBoxId ?? original.fromBoxId;
    return this.adjust({
      productId: original.productId,
      storeId,
      quantity: diff,
      condition: original.condition ?? 'new',
      reason: `Correção do movimento ${movementId} (qtd ${original.quantity} → ${newQuantity})`,
      toBoxId: originalBoxId,
    });
  }
}
