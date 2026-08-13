import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import {
  MarketplaceListingModel,
  MarketplaceListingDocument,
  MarketplaceListingStatus,
} from './schemas/marketplace-listing.schema';
import {
  StoreListingStockLotModel,
  StoreListingStockLotDocument,
} from './schemas/store-listing-stock-lot.schema';
import {
  StoreListingStockBalanceModel,
  StoreListingStockBalanceDocument,
} from './schemas/store-listing-stock-balance.schema';
import {
  StoreListingStockMovementModel,
  StoreListingStockMovementDocument,
} from './schemas/store-listing-stock-movement.schema';
import { StoreListingPort } from './ports/store-listing.port';
import { StockMovementType } from '../stock/domain/movement-type';
import { StockCondition } from '../stock/schemas/stock-lot.schema';
import { computeBalanceDelta } from '../stock/domain/balance.calculator';

@Injectable()
export class StoreListingService implements StoreListingPort {
  constructor(
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
    @InjectModel(MarketplaceListingModel.name)
    private readonly marketplaceListingModel: Model<MarketplaceListingDocument>,
    @InjectModel(StoreListingStockLotModel.name)
    private readonly storeListingStockLotModel: Model<StoreListingStockLotDocument>,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly storeListingStockBalanceModel: Model<StoreListingStockBalanceDocument>,
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly storeListingStockMovementModel: Model<StoreListingStockMovementDocument>,
  ) {}

  async create(productId: string, storeId: string): Promise<StoreListingModel & { id: string }> {
    const existing = await this.storeListingModel.findOne({ productId, storeId }).exec();
    if (existing) {
      throw new BadRequestException(
        `Já existe um StoreListing para o produto ${productId} na loja ${storeId}.`,
      );
    }
    try {
      const doc = await this.storeListingModel.create({ productId, storeId });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          `Já existe um StoreListing para o produto ${productId} na loja ${storeId}.`,
        );
      }
      throw err;
    }
  }

  async findByProductAndStore(
    productId: string,
    storeId: string,
  ): Promise<(StoreListingModel & { id: string }) | null> {
    const doc = await this.storeListingModel.findOne({ productId, storeId }).exec();
    if (!doc) return null;
    return { ...((doc as any).toObject?.() ?? doc), id: String((doc as any)._id) };
  }

  async findById(storeListingId: string): Promise<(StoreListingModel & { id: string }) | null> {
    if (!Types.ObjectId.isValid(storeListingId)) return null;
    const doc = await this.storeListingModel.findById(storeListingId).exec();
    if (!doc) return null;
    return { ...((doc as any).toObject?.() ?? doc), id: String((doc as any)._id) };
  }

  async createMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }> {
    const externalId = options?.externalId ?? null;

    // Duplicata real = mesmo externalId já publicado para este storeListingId+marketplaceTag.
    // Sem externalId (pending_creation), não há o que checar — o índice único parcial também
    // não protege esse caso (decisão explícita: criação é ação deliberada do usuário).
    if (externalId) {
      const existing = await this.marketplaceListingModel
        .findOne({ storeListingId, marketplaceTag, externalId })
        .exec();
      if (existing) {
        throw new BadRequestException(
          `Já existe uma publicação com externalId ${externalId} em ${marketplaceTag} para este StoreListing.`,
        );
      }
    }
    try {
      const doc = await this.marketplaceListingModel.create({
        storeListingId,
        marketplaceTag,
        accountId,
        externalId,
        status: options?.status ?? ('pending_creation' as MarketplaceListingStatus),
      });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          `Já existe uma publicação com externalId ${externalId} em ${marketplaceTag} para este StoreListing.`,
        );
      }
      throw err;
    }
  }

  async getMarketplaceListings(
    storeListingId: string,
  ): Promise<Array<MarketplaceListingModel & { id: string }>> {
    const docs = await this.marketplaceListingModel.find({ storeListingId }).exec();
    return docs.map((doc: any) => ({ ...(doc.toObject?.() ?? doc), id: String(doc._id) }));
  }

  async createOrGetStoreListing(
    productId: string,
    storeId: string,
  ): Promise<StoreListingModel & { id: string }> {
    const existing = await this.findByProductAndStore(productId, storeId);
    if (existing) return existing;
    return this.create(productId, storeId);
  }

  async upsertMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }> {
    const externalId = options?.externalId ?? null;
    const status = options?.status ?? ('pending_creation' as MarketplaceListingStatus);

    // Mesma lógica de "identidade real" do fix da Fase 2: um marketplace_listing
    // é o mesmo anúncio se (storeListingId, marketplaceTag, externalId) bate —
    // sem externalId (pending_creation), não há como saber se já existe, então
    // sempre cria (mesmo comportamento que createMarketplaceListing já tinha
    // para esse caso).
    const existing = externalId
      ? await this.marketplaceListingModel.findOne({ storeListingId, marketplaceTag, externalId }).exec()
      : null;

    if (existing) {
      const updated = await this.marketplaceListingModel
        .findByIdAndUpdate((existing as any)._id, { $set: { accountId, status } }, { new: true })
        .exec();
      return { ...(updated as any).toObject(), id: String((updated as any)._id) };
    }

    const doc = await this.marketplaceListingModel.create({
      storeListingId,
      marketplaceTag,
      accountId,
      externalId,
      status,
    });
    return { ...doc.toObject(), id: String(doc._id) };
  }

  async recordStockMovement(params: {
    storeListingId: string;
    type: StockMovementType;
    quantity: number;
    condition?: StockCondition;
    unitCost?: string;
    lotId?: string;
    orderId?: string;
    fromBoxId?: string;
    toBoxId?: string;
    reason?: string;
  }): Promise<{ lotId: string; movementId: string }> {
    const condition: StockCondition = params.condition ?? 'new';

    const lot = params.lotId
      ? await this.storeListingStockLotModel.findById(params.lotId).exec()
      : await this.storeListingStockLotModel
          .findOne({ storeListingId: params.storeListingId, condition })
          .exec();

    const resolvedLot =
      lot ??
      (await this.storeListingStockLotModel.create({
        storeListingId: params.storeListingId,
        condition,
        unitCost: params.unitCost,
        // originalLotId deliberately omitted — this is a net-new lot, not migrated.
      }));

    const lotId = String((resolvedLot as any)._id);
    const boxId = params.toBoxId ?? params.fromBoxId ?? null;
    const delta = computeBalanceDelta(params.type, params.quantity);

    // Atomic upsert mirroring StockRepository.applyBalanceDelta: keyed by
    // {storeListingId, lotId, boxId} (condition only set on insert), no
    // separate find-then-branch — $inc is race-safe under concurrent writes.
    await this.storeListingStockBalanceModel.updateOne(
      { storeListingId: params.storeListingId, lotId, boxId },
      { $inc: { onHand: delta.onHand, reserved: delta.reserved }, $setOnInsert: { condition } },
      { upsert: true },
    );

    const movement = await this.storeListingStockMovementModel.create({
      storeListingId: params.storeListingId,
      lotId,
      orderId: params.orderId,
      type: params.type,
      quantity: params.quantity,
      date: new Date(),
      unitCost: params.unitCost,
      fromBoxId: params.fromBoxId,
      toBoxId: params.toBoxId,
      condition,
      reason: params.reason,
      // originalMovementId deliberately omitted — this is a net-new movement, not migrated.
    });

    return { lotId, movementId: String((movement as any)._id) };
  }
}
