import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { StockRepository } from './stock.repository';
import { StockMoveInput, StockMoveSchema } from './dto/stock-move.dto';
import { StockMovementType } from './domain/movement-type';
import { computeBalanceDelta } from './domain/balance.calculator';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';

/**
 * The single entry point for ALL stock changes.
 *
 * Contract (sub-projeto 4, escrita — 2026-08-29): store_listing_stock_* é a fonte PRIMÁRIA.
 * move() grava ali dentro de uma transação real (idempotência, resolução/criação de lote,
 * atualização de saldo), e espelha pro legado (stock_balances/stock_lots/stock_movements)
 * DEPOIS, fire-and-log — nunca bloqueia, nunca falha o move(). Inverte a direção da Fase 3/4
 * original (legado primário, StoreListing espelho) — ver
 * docs/superpowers/specs/2026-08-29-stock-write-cutover-design.md.
 *
 * Quando dado um externalSession (o chamador é dono da transação — ex. OrderSyncPipeline via
 * StockLedgerProvider.deductAndLink), a escrita primária (StoreListing) participa dessa mesma
 * transação — não pode ser pulada, é a escrita real. Só o mirror pro legado é pulado nesse caso
 * (espelhar antes do commit real do chamador seria espelhar algo que pode nunca commitar); o
 * chamador é responsável por disparar o mirror ele mesmo pós-commit (mirrorMoveToLegacy).
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly repo: StockRepository,
    @Inject(STORE_LISTING_PORT)
    private readonly storeListingPort: StoreListingPort,
  ) {}

  async move(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    let result: { movementId: string; lotId: string };

    if (externalSession) {
      result = await this.moveOnce(input, externalSession);
    } else {
      result = await this.moveWithRetry(input);
    }

    // Espelha no legado DEPOIS que a escrita primária já terminou (commit incluído) — nunca
    // antes, nunca dentro da mesma transação (ver mirrorMoveToLegacy). Sentinela {'', ''} =
    // moveOnce abortou por idempotência (reference duplicada): não houve escrita real, então
    // não há o que espelhar.
    if (!externalSession && (result.movementId !== '' || result.lotId !== '')) {
      const dto = StockMoveSchema.parse(input);
      await this.mirrorMoveToLegacy(dto);
    }

    return result;
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

  /**
   * Fire-and-log mirror para stock_balances/stock_lots/stock_movements (legado) — NUNCA bloqueia
   * nem falha move(). Não usa a session da transação primária: se o espelho abortasse depois,
   * reverteria uma escrita primária que já "aconteceu" do ponto de vista do chamador.
   */
  async mirrorMoveToLegacy(dto: StockMoveInput): Promise<void> {
    try {
      const productId = new Types.ObjectId(dto.productId);
      const storeId = new Types.ObjectId(dto.storeId);
      const unitCost = Types.Decimal128.fromString(String(dto.unitCost ?? 0));
      const lot = await this.repo.findOrCreateLot(productId, dto.condition, unitCost);

      const appendOne = async (
        type: StockMovementType,
        quantity: number,
        fromBoxId?: string,
        toBoxId?: string,
        withReference = true,
      ) => {
        await this.repo.appendMovement({
          lotId: lot._id,
          productId,
          storeId,
          type,
          quantity,
          unitCost,
          condition: dto.condition,
          fromBoxId: fromBoxId ? new Types.ObjectId(fromBoxId) : undefined,
          toBoxId: toBoxId ? new Types.ObjectId(toBoxId) : undefined,
          orderId: dto.orderId ? new Types.ObjectId(dto.orderId) : undefined,
          reason: dto.reason,
          origin: dto.origin ? { type: dto.origin.type, location: dto.origin.location } : undefined,
          metadata:
            withReference && (dto.reference != null || dto.salePrice != null)
              ? {
                  ...(dto.reference != null ? { externalReference: dto.reference } : {}),
                  ...(dto.salePrice != null ? { salePrice: dto.salePrice } : {}),
                }
              : undefined,
        });
        const delta = computeBalanceDelta(type, quantity);
        const boxId = toBoxId ? new Types.ObjectId(toBoxId) : fromBoxId ? new Types.ObjectId(fromBoxId) : null;
        await this.repo.applyBalanceDelta(lot._id, productId, dto.condition, boxId, delta.onHand, delta.reserved);
      };

      if (dto.type === StockMovementType.TRANSFER) {
        // Mesmo tratamento que a escrita primária: TRANSFER vira dois ADJUSTMENT assinados
        // (débito no fromBoxId, crédito no toBoxId) — ver moveOnce. reference só na segunda
        // perna: gravar nas duas colidiria no índice único de idempotência (mesma reference
        // duas vezes para o mesmo produto/tipo).
        await appendOne(StockMovementType.ADJUSTMENT, -dto.quantity, dto.fromBoxId, undefined, false);
        await appendOne(StockMovementType.ADJUSTMENT, dto.quantity, undefined, dto.toBoxId, true);
        return;
      }

      await appendOne(dto.type, dto.quantity, dto.fromBoxId, dto.toBoxId);
    } catch (err: any) {
      this.logger.error(`[mirror-to-legacy] falha ao espelhar movimento do produto ${dto.productId}: ${err?.message}`);
    }
  }

  private async moveOnce(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    const dto = StockMoveSchema.parse(input);

    const session = externalSession ?? (await this.repo.getConnection().startSession());
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
