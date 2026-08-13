import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { StockRepository } from './stock.repository';
import { StockMoveInput, StockMoveSchema } from './dto/stock-move.dto';
import { StockMovementType } from './domain/movement-type';
import { computeBalanceDelta } from './domain/balance.calculator';
import { weightedAverageCost } from './domain/average-cost';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { STORE_PORT, StorePort } from '../store/ports/store.port';

/**
 * The single entry point for ALL stock changes. Appends to the immutable ledger AND updates
 * the materialized balance in the same transaction — never one without the other. When given an
 * external session (e.g. OrderSyncPipeline) it joins that transaction → atomicity with the order.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly repo: StockRepository,
    @Inject(STORE_LISTING_PORT)
    private readonly storeListingPort: StoreListingPort,
    @Inject(STORE_PORT)
    private readonly storePort: StorePort,
  ) {}

  async move(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
    let result: { movementId: string; lotId: string };

    if (externalSession) {
      result = await this.moveOnce(input, externalSession);
    } else {
      result = await this.moveWithRetry(input);
    }

    // Fase 3 dual-write: espelha em store_listing_stock_* DEPOIS que o legado já
    // terminou (commit incluído) — nunca antes, nunca dentro da mesma transação
    // (ver mirrorMoveToStoreListing para o porquê de não propagar session).
    // Sentinela {'', ''} = moveOnce abortou por idempotência (reference duplicada):
    // não houve escrita real, então não há o que espelhar.
    if (result.movementId !== '' || result.lotId !== '') {
      const dto = StockMoveSchema.parse(input);
      await this.mirrorMoveToStoreListing(dto);
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
   * Resolve qual loja é dona do estoque deste produto pra fins de dual-write
   * (Fase 3): fallback "Rocket Automotive" — mesmo critério do backfill da
   * Fase 2 (resolveOwnerStore). A busca por um StoreListing JÁ existente do
   * produto (independente da loja) é feita separadamente via
   * STORE_LISTING_PORT.findAnyByProduct, antes de cair neste fallback. Nunca
   * lança: quem chama trata retorno null como "pula o dual-write desta
   * chamada", não como erro.
   */
  private async resolveStoreIdForDualWrite(): Promise<string | null> {
    const fallbackStore = await this.storePort.findByName('Rocket Automotive');
    return fallbackStore?.id ?? null;
  }

  /**
   * Fire-and-log mirror do movimento pra store_listing_stock_* — NUNCA bloqueia
   * nem falha o move() legado (por isso não propaga a session da transação
   * legada: se o espelho abortasse depois, reverteria uma escrita legada que já
   * "aconteceu" do ponto de vista do chamador).
   */
  private async mirrorMoveToStoreListing(dto: StockMoveInput): Promise<void> {
    try {
      // Existing StoreListing anywhere for this product wins over the fallback store —
      // mirrors the Phase 2 backfill's resolution rule (resolveOwnerStore).
      let storeListing = await this.storeListingPort.findAnyByProduct(dto.productId);
      if (!storeListing) {
        const storeId = await this.resolveStoreIdForDualWrite();
        if (!storeId) {
          this.logger.error(`[dual-write] loja padrão não resolvida — movimento do produto ${dto.productId} não espelhado.`);
          return;
        }
        storeListing = await this.storeListingPort.createOrGetStoreListing(dto.productId, storeId);
      }

      const unitCost = dto.unitCost != null ? String(dto.unitCost) : undefined;

      if (dto.type === StockMovementType.TRANSFER) {
        // TRANSFER nets to {onHand:0, reserved:0} on both sides (legacy `computeBalanceDelta`
        // and the store-listing repo's internal recompute agree on that) — mirroring it as a
        // single TRANSFER call would silently record a zero-effect no-op movement and lose the
        // box-to-box change entirely. Mirror it as the same two signed writes moveOnce() itself
        // performs against StockRepository.applyBalanceDelta: a debit at fromBoxId and a credit
        // at toBoxId. ADJUSTMENT has effect {onHand: 1 * quantity} — a raw signed delta — so
        // using it for both legs reproduces the exact same balance math as the legacy transfer.
        await this.storeListingPort.recordStockMovement({
          storeListingId: storeListing.id,
          type: StockMovementType.ADJUSTMENT,
          quantity: -dto.quantity,
          condition: dto.condition,
          unitCost,
          fromBoxId: dto.fromBoxId,
          reason: dto.reason,
        });
        await this.storeListingPort.recordStockMovement({
          storeListingId: storeListing.id,
          type: StockMovementType.ADJUSTMENT,
          quantity: dto.quantity,
          condition: dto.condition,
          unitCost,
          toBoxId: dto.toBoxId,
          reason: dto.reason,
        });
        return;
      }

      await this.storeListingPort.recordStockMovement({
        storeListingId: storeListing.id,
        type: dto.type,
        quantity: dto.quantity,
        condition: dto.condition,
        unitCost,
        fromBoxId: dto.fromBoxId,
        toBoxId: dto.toBoxId,
        reason: dto.reason,
      });
    } catch (err: any) {
      this.logger.error(`[dual-write] falha ao espelhar movimento do produto ${dto.productId}: ${err?.message}`);
    }
  }


  private async moveOnce(input: StockMoveInput, externalSession?: ClientSession): Promise<{ movementId: string; lotId: string }> {
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
      toBoxId?: string;
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
        toBoxId: input.toBoxId,
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
    const originalBoxId = (original as any).toBoxId ?? (original as any).fromBoxId;
    // Compensate the net onHand effect with an adjustment of the opposite sign, in the same box.
    return this.adjust({
      productId: String((original as any).productId),
      quantity: -delta.onHand,
      condition: (original as any).condition ?? 'new',
      reason: `Estorno do movimento ${movementId}`,
      toBoxId: originalBoxId ? String(originalBoxId) : undefined,
    });
  }

  /**
   * Correct total on-hand for a (product, condition) to an absolute target — the UI-facing
   * "o estoque real é X" flow. Computes the diff against the current materialized balance and
   * posts a single signed adjustment; a no-op (target === current) creates nothing.
   */
  async correctTo(input: {
    productId: string;
    targetQuantity: number;
    condition?: 'new' | 'damaged' | 'used' | 'refurbished';
  }): Promise<{ movementId: string; lotId: string } | null> {
    const condition = input.condition ?? 'new';
    const productId = new Types.ObjectId(input.productId);
    const current = await this.repo.getConditionOnHand(productId, condition);
    const diff = input.targetQuantity - current;
    if (diff === 0) return null;
    return this.adjust({
      productId: input.productId,
      quantity: diff,
      condition,
      reason: `Correção de estoque: ${current} → ${input.targetQuantity}`,
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
    const originalBoxId = (original as any).toBoxId ?? (original as any).fromBoxId;
    return this.adjust({
      productId: String((original as any).productId),
      quantity: diff,
      condition: (original as any).condition ?? 'new',
      reason: `Correção do movimento ${movementId} (qtd ${(original as any).quantity} → ${newQuantity})`,
      toBoxId: originalBoxId ? String(originalBoxId) : undefined,
    });
  }
}
