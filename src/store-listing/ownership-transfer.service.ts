import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import {
  StoreListingStockBalanceModel,
  StoreListingStockBalanceDocument,
} from './schemas/store-listing-stock-balance.schema';
import {
  StoreListingStockLotModel,
  StoreListingStockLotDocument,
} from './schemas/store-listing-stock-lot.schema';
import {
  StoreListingStockMovementModel,
  StoreListingStockMovementDocument,
} from './schemas/store-listing-stock-movement.schema';
import {
  StoreListingDamagedUnitModel,
  StoreListingDamagedUnitDocument,
} from './schemas/store-listing-damaged-unit.schema';
import {
  MarketplaceListingModel,
  MarketplaceListingDocument,
} from './schemas/marketplace-listing.schema';
import { OwnershipTransferLogModel, OwnershipTransferLogDocument } from './schemas/ownership-transfer-log.schema';
import { ListingModel, ListingDocument } from '../listing/schemas/listing.schema';
import { planOwnershipTransfer, mergeBalancesByCondition, TransferBalanceRow } from './ownership-transfer.logic';

export interface TransferOwnershipResult {
  kind: 'noop' | 'repoint' | 'merge';
  sourceStoreListingId: string | null;
  destinationStoreListingId: string | null;
}

/**
 * Único ponto de entrada permitido para mudar a loja dona de um listing/StoreListing. Ver
 * ownership-transfer.logic.ts para o racional completo e docs/superpowers/specs/
 * 2026-08-30-store-listing-ownership-transfer-design.md para o design.
 *
 * Nenhum outro código deve fazer ListingModel.updateOne({storeId}) ou StoreListingModel.updateOne
 * ({storeId}) diretamente — isso recria a mesma classe de bug que motivou esta operação.
 */
@Injectable()
export class StoreListingOwnershipService {
  private readonly logger = new Logger(StoreListingOwnershipService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ListingModel.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly balanceModel: Model<StoreListingStockBalanceDocument>,
    @InjectModel(StoreListingStockLotModel.name)
    private readonly lotModel: Model<StoreListingStockLotDocument>,
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly movementModel: Model<StoreListingStockMovementDocument>,
    @InjectModel(StoreListingDamagedUnitModel.name)
    private readonly damagedUnitModel: Model<StoreListingDamagedUnitDocument>,
    @InjectModel(MarketplaceListingModel.name)
    private readonly marketplaceListingModel: Model<MarketplaceListingDocument>,
    @InjectModel(OwnershipTransferLogModel.name)
    private readonly transferLogModel: Model<OwnershipTransferLogDocument>,
  ) {}

  async transferOwnership(params: {
    productId: string;
    fromStoreId: string;
    toStoreId: string;
    reason: string;
    triggeredBy?: string;
    dryRun?: boolean;
  }): Promise<TransferOwnershipResult> {
    const { productId, fromStoreId, toStoreId, reason, triggeredBy, dryRun = false } = params;

    if (fromStoreId === toStoreId) {
      throw new BadRequestException('fromStoreId e toStoreId são a mesma loja — nada a transferir.');
    }

    return this.withRetry(() => this.runOnce(params, { productId, fromStoreId, toStoreId, reason, triggeredBy, dryRun }));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isTransient = err?.errorLabels?.includes('TransientTransactionError');
        if (!isTransient || attempt === maxAttempts) throw err;
        this.logger.warn(`[OwnershipTransfer] transient write conflict — retry ${attempt}/${maxAttempts}`);
      }
    }
    throw new Error('unreachable');
  }

  private async runOnce(
    _unused: unknown,
    params: {
      productId: string;
      fromStoreId: string;
      toStoreId: string;
      reason: string;
      triggeredBy?: string;
      dryRun: boolean;
    },
  ): Promise<TransferOwnershipResult> {
    const { productId, fromStoreId, toStoreId, reason, triggeredBy, dryRun } = params;
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const productOid = new Types.ObjectId(productId);
      const fromStoreOid = new Types.ObjectId(fromStoreId);
      const toStoreOid = new Types.ObjectId(toStoreId);

      const sourceStoreListing = await this.storeListingModel
        .findOne({ productId: productOid, storeId: fromStoreOid })
        .session(session)
        .lean()
        .exec();

      const destinationStoreListing = await this.storeListingModel
        .findOne({ productId: productOid, storeId: toStoreOid })
        .session(session)
        .lean()
        .exec();

      const sourceBalances: TransferBalanceRow[] = sourceStoreListing
        ? await this.balanceModel
            .find({ storeListingId: sourceStoreListing._id })
            .session(session)
            .lean()
            .exec()
        : [];

      const plan = planOwnershipTransfer({
        productId: productOid,
        fromStoreId: fromStoreOid,
        toStoreId: toStoreOid,
        sourceStoreListing: sourceStoreListing
          ? { _id: sourceStoreListing._id, storeId: sourceStoreListing.storeId }
          : null,
        destinationStoreListing: destinationStoreListing
          ? { _id: destinationStoreListing._id, storeId: destinationStoreListing.storeId }
          : null,
        sourceBalances,
      });

      if (plan.kind === 'blocked') {
        throw new BadRequestException(
          `Transferência bloqueada: StoreListing ${plan.storeListingId} tem saldo com boxId preenchido (depósito físico) — precisa de migração manual, não suportado por transferOwnership.`,
        );
      }

      if (plan.kind === 'noop') {
        await session.abortTransaction();
        return { kind: 'noop', sourceStoreListingId: null, destinationStoreListingId: null };
      }

      if (dryRun) {
        await session.abortTransaction();
        return {
          kind: plan.kind,
          sourceStoreListingId: String(plan.sourceStoreListingId),
          destinationStoreListingId:
            plan.kind === 'merge' ? String(plan.destinationStoreListingId) : null,
        };
      }

      if (plan.kind === 'repoint') {
        await this.storeListingModel
          .updateOne({ _id: plan.sourceStoreListingId }, { $set: { storeId: toStoreOid } })
          .session(session)
          .exec();
      } else {
        await this.executeMerge(plan.sourceStoreListingId, plan.destinationStoreListingId, session);
      }

      await this.listingModel
        .updateMany({ productId: productOid, storeId: fromStoreOid }, { $set: { storeId: toStoreOid } })
        .session(session)
        .exec();

      await this.transferLogModel.create(
        [
          {
            productId: productOid,
            fromStoreId: fromStoreOid,
            toStoreId: toStoreOid,
            kind: plan.kind,
            sourceStoreListingId: plan.sourceStoreListingId,
            destinationStoreListingId: plan.kind === 'merge' ? plan.destinationStoreListingId : null,
            reason,
            triggeredBy: triggeredBy ?? null,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return {
        kind: plan.kind,
        sourceStoreListingId: String(plan.sourceStoreListingId),
        destinationStoreListingId:
          plan.kind === 'merge' ? String(plan.destinationStoreListingId) : null,
      };
    } catch (err) {
      await session.abortTransaction().catch(() => undefined);
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Move todos os filhos do StoreListing de origem para o de destino (lots/movements/damaged_units
   * reapontando storeListingId; marketplace_listings reapontando storeListingId, checando conflito
   * de externalId antes; balances somados por condition), depois apaga origem esvaziada.
   */
  private async executeMerge(
    sourceId: Types.ObjectId,
    destinationId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const [sourceBalances, destinationBalances] = await Promise.all([
      this.balanceModel.find({ storeListingId: sourceId }).session(session).lean().exec(),
      this.balanceModel.find({ storeListingId: destinationId }).session(session).lean().exec(),
    ]);

    const merged = mergeBalancesByCondition(sourceBalances, destinationBalances);

    for (const row of merged) {
      await this.balanceModel
        .updateOne(
          { storeListingId: destinationId, condition: row.condition },
          { $set: { onHand: row.onHand, reserved: row.reserved, storeListingId: destinationId, condition: row.condition } },
          { upsert: true, session },
        )
        .exec();
    }
    await this.balanceModel.deleteMany({ storeListingId: sourceId }).session(session).exec();

    // store_listing_stock_lots tem unique {storeListingId, condition} — igual balances, um simples
    // updateMany(storeListingId) colide quando o destino já tem um lot da mesma condition (achado em
    // produção 2026-08-30: 35/883 casos, todos aqui, quando o mesmo produto tinha DOIS StoreListing
    // errados fundindo pro mesmo destino). Resolve por condition: se o destino já tem um lot dessa
    // condition, reaponta os movements do lot de origem pro lot vencedor (destino) antes de descartar
    // o lot de origem — nunca perde a referência de um movement.
    const [sourceLots, destinationLots] = await Promise.all([
      this.lotModel.find({ storeListingId: sourceId }).session(session).lean().exec(),
      this.lotModel.find({ storeListingId: destinationId }).session(session).lean().exec(),
    ]);
    const destinationLotByCondition = new Map(destinationLots.map((l: any) => [l.condition, l]));

    for (const lot of sourceLots) {
      const existingDestinationLot = destinationLotByCondition.get((lot as any).condition);
      if (existingDestinationLot) {
        await this.movementModel
          .updateMany(
            { storeListingId: sourceId, lotId: lot._id },
            { $set: { storeListingId: destinationId, lotId: (existingDestinationLot as any)._id } },
          )
          .session(session)
          .exec();
        await this.lotModel.deleteOne({ _id: lot._id }).session(session).exec();
      } else {
        await this.lotModel.updateOne({ _id: lot._id }, { $set: { storeListingId: destinationId } }).session(session).exec();
        await this.movementModel
          .updateMany({ storeListingId: sourceId, lotId: lot._id }, { $set: { storeListingId: destinationId } })
          .session(session)
          .exec();
        destinationLotByCondition.set((lot as any).condition, { ...lot, storeListingId: destinationId });
      }
    }

    // movements sem lotId (não referenciam um lot — ex. reservas) só precisam reapontar storeListingId.
    await this.movementModel.updateMany({ storeListingId: sourceId }, { $set: { storeListingId: destinationId } }).session(session).exec();
    await this.damagedUnitModel.updateMany({ storeListingId: sourceId }, { $set: { storeListingId: destinationId } }).session(session).exec();

    const sourceMarketplaceListings = await this.marketplaceListingModel
      .find({ storeListingId: sourceId })
      .session(session)
      .lean()
      .exec();

    for (const ml of sourceMarketplaceListings) {
      if (ml.externalId) {
        const conflict = await this.marketplaceListingModel
          .findOne({ storeListingId: destinationId, marketplaceTag: ml.marketplaceTag, externalId: ml.externalId })
          .session(session)
          .lean()
          .exec();
        if (conflict) {
          throw new BadRequestException(
            `Conflito de merge: já existe marketplace_listing ${ml.marketplaceTag}/${ml.externalId} sob o StoreListing de destino ${destinationId}.`,
          );
        }
      }
      await this.marketplaceListingModel
        .updateOne({ _id: ml._id }, { $set: { storeListingId: destinationId } })
        .session(session)
        .exec();
    }

    await this.storeListingModel.deleteOne({ _id: sourceId }).session(session).exec();
  }
}
