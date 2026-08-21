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
import {
  StoreListingWarehouseModel,
  StoreListingWarehouseDocument,
} from './schemas/store-listing-warehouse.schema';
import {
  StoreListingDamagedUnitModel,
  StoreListingDamagedUnitDocument,
  DamagedUnitCondition,
  DamagedUnitStatus,
} from './schemas/store-listing-damaged-unit.schema';
import {
  StoreListingDamagedAllocationModel,
  StoreListingDamagedAllocationDocument,
} from './schemas/store-listing-damaged-allocation.schema';
import { AllocationModel, AllocationDocument } from '../product/schemas/allocation.schema';
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
    @InjectModel(StoreListingWarehouseModel.name)
    private readonly storeListingWarehouseModel: Model<StoreListingWarehouseDocument>,
    @InjectModel(StoreListingDamagedUnitModel.name)
    private readonly storeListingDamagedUnitModel: Model<StoreListingDamagedUnitDocument>,
    @InjectModel(StoreListingDamagedAllocationModel.name)
    private readonly storeListingDamagedAllocationModel: Model<StoreListingDamagedAllocationDocument>,
    @InjectModel(AllocationModel.name)
    private readonly allocationModel: Model<AllocationDocument>,
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

  async findAnyByProduct(productId: string): Promise<(StoreListingModel & { id: string }) | null> {
    const doc = await this.storeListingModel.findOne({ productId }).sort({ _id: 1 }).exec();
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
    try {
      return await this.create(productId, storeId);
    } catch (err: any) {
      // Concurrent-creation race: two callers both missed the findByProductAndStore check
      // above (neither existed yet), one won the insert, the other hit the unique index
      // {productId, storeId} inside create() and got a BadRequestException. The loser must
      // NOT propagate that error — it should end up with the SAME StoreListing the winner
      // just created, not an exception. `create()` itself still throws on duplicates for
      // its OTHER callers (that contract is intentional and unchanged); only this internal
      // race-recovery path re-reads instead of surfacing the error.
      const isDuplicateKeyRace =
        err instanceof BadRequestException &&
        typeof err.message === 'string' &&
        err.message.includes('Já existe um StoreListing');
      if (!isDuplicateKeyRace) throw err;

      const winner = await this.findByProductAndStore(productId, storeId);
      if (!winner) throw err; // truly bizarre case — surface the original error rather than return null.
      return winner;
    }
  }

  async upsertMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }> {
    const externalId = options?.externalId ?? null;
    const status = options?.status ?? ('pending_creation' as MarketplaceListingStatus);

    // Identidade de um marketplace_listing:
    //  - Com externalId: (storeListingId, marketplaceTag, externalId) — mesma lógica do fix
    //    da Fase 2, o externalId é a identidade permanente de um anúncio publicado.
    //  - Sem externalId (ainda pending_creation/error — ex.: publish assíncrono do OLX, ou
    //    uma falha antes de obter o externalId): trata-se do MESMO anúncio lógico sendo
    //    rastreado através de pending/error até publicar de verdade. Deve haver no máximo
    //    UM MarketplaceListing por (storeListingId, marketplaceTag) sem externalId — por
    //    isso o lookup usa {storeListingId, marketplaceTag, externalId: null} em vez de
    //    pular a busca. Sem isso, cada retry do SyncQueue (backoff) ou cada poll do
    //    OLX criaria uma linha nova, duplicando indefinidamente.
    const existing = await this.marketplaceListingModel
      .findOne({ storeListingId, marketplaceTag, externalId })
      .exec();

    if (existing) {
      const updated = await this.marketplaceListingModel
        .findByIdAndUpdate((existing as any)._id, { $set: { accountId, status } }, { new: true })
        .exec();
      return { ...(updated as any).toObject(), id: String((updated as any)._id) };
    }

    // Transição pending→publicado: havia uma linha pending_creation/error sem externalId
    // rastreando este (storeListingId, marketplaceTag) e agora chegou um externalId real
    // (primeiro publish bem-sucedido). O lookup acima não encontra essa linha (ela tem
    // externalId:null, buscamos por externalId real) — herdamos o _id dela em vez de criar
    // uma linha nova e deixar a antiga órfã em pending_creation para sempre.
    if (externalId) {
      const pending = await this.marketplaceListingModel
        .findOne({ storeListingId, marketplaceTag, externalId: null })
        .exec();
      if (pending) {
        const updated = await this.marketplaceListingModel
          .findByIdAndUpdate((pending as any)._id, { $set: { accountId, status, externalId } }, { new: true })
          .exec();
        return { ...(updated as any).toObject(), id: String((updated as any)._id) };
      }
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
    // updateOne com upsert NÃO aplica cast de schema no valor do filtro pro documento novo —
    // sem isso, storeListingId ficaria salvo como string em vez de ObjectId, quebrando
    // comparação de igualdade em aggregation ($match) que espera o tipo BSON correto.
    const storeListingId = new Types.ObjectId(params.storeListingId);

    // findOneAndUpdate com upsert:true é atômico no Mongo: sob concorrência, a segunda
    // chamada para o mesmo (storeListingId, condition) enxerga o lote que a primeira acabou
    // de inserir, em vez de cada uma criar o seu (era exatamente essa race, num find-then-create
    // de duas etapas, que produziu lotes duplicados em produção — ver stock-lot dedupe script).
    const resolvedLot = params.lotId
      ? await this.storeListingStockLotModel.findById(params.lotId).exec()
      : await this.storeListingStockLotModel
          .findOneAndUpdate(
            { storeListingId, condition },
            {
              $setOnInsert: {
                storeListingId,
                condition,
                unitCost: params.unitCost,
                // originalLotId deliberately omitted — this is a net-new lot, not migrated.
              },
            },
            { upsert: true, new: true },
          )
          .exec();

    const lotId: Types.ObjectId = (resolvedLot as any)._id;
    const boxIdRaw = params.toBoxId ?? params.fromBoxId ?? null;
    const boxId = boxIdRaw ? new Types.ObjectId(boxIdRaw) : null;
    const delta = computeBalanceDelta(params.type, params.quantity);

    // Atomic upsert mirroring StockRepository.applyBalanceDelta: keyed by
    // {storeListingId, lotId, boxId} (condition only set on insert), no
    // separate find-then-branch — $inc is race-safe under concurrent writes.
    await this.storeListingStockBalanceModel.updateOne(
      { storeListingId, lotId, boxId },
      { $inc: { onHand: delta.onHand, reserved: delta.reserved }, $setOnInsert: { condition } },
      { upsert: true },
    );

    const movement = await this.storeListingStockMovementModel.create({
      storeListingId,
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

    return { lotId: String(lotId), movementId: String((movement as any)._id) };
  }

  async getStockSummary(
    productId: string,
    storeId: string,
  ): Promise<{ onHand: number; reserved: number; available: number; avgCost: number }> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return { onHand: 0, reserved: 0, available: 0, avgCost: 0 };

    const storeListingId = new Types.ObjectId(listing.id);
    const balances = await this.storeListingStockBalanceModel.aggregate([
      { $match: { storeListingId } },
      { $group: { _id: '$storeListingId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
    ]);
    const onHand = balances[0]?.onHand ?? 0;
    const reserved = balances[0]?.reserved ?? 0;

    const costRows = await this.storeListingStockBalanceModel.aggregate([
      { $match: { storeListingId } },
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
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;

    return { onHand, reserved, available: onHand - reserved, avgCost };
  }

  async getStockByCondition(
    productId: string,
    storeId: string,
  ): Promise<Array<{ condition: StockCondition; onHand: number; reserved: number }>> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return [];

    return this.storeListingStockBalanceModel.aggregate([
      { $match: { storeListingId: new Types.ObjectId(listing.id) } },
      { $group: { _id: '$condition', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, condition: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async getStockByLocation(
    productId: string,
    storeId: string,
  ): Promise<Array<{ boxId: string | null; onHand: number; reserved: number }>> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return [];

    return this.storeListingStockBalanceModel.aggregate([
      { $match: { storeListingId: new Types.ObjectId(listing.id) } },
      { $group: { _id: '$boxId', onHand: { $sum: '$onHand' }, reserved: { $sum: '$reserved' } } },
      { $project: { _id: 0, boxId: '$_id', onHand: 1, reserved: 1 } },
    ]);
  }

  async listStockMovements(
    productId: string,
    storeId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      type: StockMovementType;
      quantity: number;
      date: Date;
      unitCost?: number;
      salePrice?: number;
      condition: StockCondition;
      reason?: string;
    }>
  > {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return [];

    const rows = await this.storeListingStockMovementModel
      .find({ storeListingId: new Types.ObjectId(listing.id) })
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
    }));
  }

  async getStockMovementStatistics(
    productId: string,
    storeId: string,
  ): Promise<Record<string, { count: number; quantity: number }>> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return {};

    const rows = await this.storeListingStockMovementModel.aggregate([
      { $match: { storeListingId: new Types.ObjectId(listing.id) } },
      { $group: { _id: '$type', count: { $sum: 1 }, quantity: { $sum: '$quantity' } } },
    ]);
    const out: Record<string, { count: number; quantity: number }> = {};
    for (const r of rows) out[r._id] = { count: r.count, quantity: r.quantity };
    return out;
  }

  async createWarehouse(
    storeId: string,
    name: string,
    address?: string,
  ): Promise<StoreListingWarehouseModel & { id: string }> {
    try {
      const doc = await this.storeListingWarehouseModel.create({ storeId, name, address });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(`Já existe um depósito chamado "${name}" nesta loja.`);
      }
      throw err;
    }
  }

  async listWarehouses(storeId: string): Promise<Array<StoreListingWarehouseModel & { id: string }>> {
    const docs = await this.storeListingWarehouseModel.find({ storeId }).exec();
    return docs.map((doc: any) => ({ ...(doc.toObject?.() ?? doc), id: String(doc._id) }));
  }

  async createAllocation(
    storeId: string,
    params: { warehouseId: string; locationPath: string; metadata?: Record<string, any>; available?: boolean },
  ): Promise<AllocationModel & { id: string }> {
    const warehouse = await this.storeListingWarehouseModel.findById(params.warehouseId).exec();
    if (!warehouse) throw new BadRequestException(`Depósito ${params.warehouseId} não encontrado.`);
    if (String((warehouse as any).storeId) !== String(storeId)) {
      throw new BadRequestException('O depósito informado pertence a outra loja.');
    }
    try {
      const doc = await this.allocationModel.create({
        warehouseId: params.warehouseId,
        locationPath: params.locationPath,
        metadata: params.metadata ?? {},
        available: params.available ?? true,
        active: true,
      });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException('Já existe uma alocação com este caminho neste depósito.');
      }
      throw err;
    }
  }

  async listAllocations(storeId: string): Promise<Array<AllocationModel & { id: string }>> {
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    if (warehouseIds.length === 0) return [];
    const docs = await this.allocationModel.find({ warehouseId: { $in: warehouseIds } }).exec();
    return docs.map((doc: any) => ({ ...(doc.toObject?.() ?? doc), id: String(doc._id) }));
  }

  async findWarehouseById(
    warehouseId: string,
  ): Promise<(StoreListingWarehouseModel & { id: string }) | null> {
    if (!Types.ObjectId.isValid(warehouseId)) return null;
    const doc = await this.storeListingWarehouseModel.findById(warehouseId).exec();
    if (!doc) return null;
    return { ...((doc as any).toObject?.() ?? doc), id: String((doc as any)._id) };
  }

  /**
   * Resolve o StoreListing de (productId, storeId) e garante que existe — usado por todo
   * endpoint de damaged units que recebe productId do client (nunca storeListingId cru, que
   * permitiria uma loja ler/escrever unidades de outra passando qualquer id por engano ou
   * má-fé). Mesmo padrão de StockController/ProductMovementController.
   */
  private async requireStoreListing(productId: string, storeId: string): Promise<string> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) {
      throw new BadRequestException(`Produto ${productId} não tem StoreListing na loja ${storeId}.`);
    }
    return listing.id;
  }

  /**
   * Garante que a unidade avariada pertence à loja informada antes de qualquer leitura/escrita
   * por unitId — sem isso, um unitId de outra loja passaria despercebido (unitId sozinho não
   * carrega informação de loja nenhuma).
   */
  private async requireDamagedUnitInStore(unitId: string, storeId: string): Promise<StoreListingDamagedUnitDocument> {
    const unit = await this.storeListingDamagedUnitModel.findById(unitId).exec();
    if (!unit) throw new BadRequestException(`Unidade avariada ${unitId} não encontrada.`);

    const listing = await this.storeListingModel.findById((unit as any).storeListingId).exec();
    if (!listing || String((listing as any).storeId) !== String(storeId)) {
      throw new BadRequestException(`Unidade avariada ${unitId} não encontrada.`);
    }
    return unit;
  }

  async markUnitsAsDamaged(params: {
    productId: string;
    storeId: string;
    sourceCondition: 'new';
    quantity: number;
    targetCondition: DamagedUnitCondition;
    reason?: string;
  }): Promise<{ unitIds: string[] }> {
    if (params.quantity <= 0) {
      throw new BadRequestException('A quantidade de unidades avariadas deve ser maior que zero.');
    }

    const storeListingId = await this.requireStoreListing(params.productId, params.storeId);

    // Debita do lote fungível via o mesmo mecanismo de ajuste usado por correções de estoque
    // (StockService.correctTo reusa adjust() da mesma forma — nenhuma primitiva nova de escrita).
    const { lotId } = await this.recordStockMovement({
      storeListingId,
      type: StockMovementType.ADJUSTMENT,
      quantity: -params.quantity,
      condition: params.sourceCondition,
      reason: params.reason ?? `Marcado como ${params.targetCondition}`,
    });

    const unitIds: string[] = [];
    for (let i = 0; i < params.quantity; i++) {
      const doc = await this.storeListingDamagedUnitModel.create({
        storeListingId: new Types.ObjectId(storeListingId),
        sourceLotId: new Types.ObjectId(lotId),
        condition: params.targetCondition,
        status: 'in_stock',
      });
      unitIds.push(String((doc as any)._id));
    }

    return { unitIds };
  }

  async updateDamagedUnit(
    unitId: string,
    storeId: string,
    patch: { photos?: string[]; damageNotes?: string; price?: number },
  ): Promise<StoreListingDamagedUnitModel & { id: string }> {
    await this.requireDamagedUnitInStore(unitId, storeId);

    const set: Record<string, any> = {};
    if (patch.photos !== undefined) set.photos = patch.photos;
    if (patch.damageNotes !== undefined) set.damageNotes = patch.damageNotes;
    if (patch.price !== undefined) set.price = patch.price;

    const updated = await this.storeListingDamagedUnitModel
      .findByIdAndUpdate(unitId, { $set: set }, { new: true })
      .exec();
    return { ...(updated as any).toObject(), id: String((updated as any)._id) };
  }

  async allocateDamagedUnit(
    unitId: string,
    storeId: string,
    warehouseId: string,
    position?: string,
  ): Promise<StoreListingDamagedAllocationModel & { id: string }> {
    await this.requireDamagedUnitInStore(unitId, storeId);

    const warehouse = await this.storeListingWarehouseModel.findById(warehouseId).exec();
    if (!warehouse) throw new BadRequestException(`Depósito ${warehouseId} não encontrado.`);
    if (String((warehouse as any).storeId) !== String(storeId)) {
      throw new BadRequestException('O depósito informado pertence a outra loja.');
    }

    const doc = await this.storeListingDamagedAllocationModel.findOneAndUpdate(
      { damagedUnitId: unitId },
      { $set: { warehouseId, position } },
      { upsert: true, new: true },
    );
    return { ...(doc as any).toObject(), id: String((doc as any)._id) };
  }

  async isDamagedUnitPublishable(unitId: string): Promise<boolean> {
    const unit = await this.storeListingDamagedUnitModel.findById(unitId).exec();
    if (!unit) return false;
    const u: any = unit;
    return (u.photos?.length ?? 0) >= 1 && !!u.damageNotes && u.price != null;
  }

  async listDamagedUnits(
    productId: string,
    storeId: string,
    status?: DamagedUnitStatus,
  ): Promise<Array<StoreListingDamagedUnitModel & { id: string }>> {
    const listing = await this.findByProductAndStore(productId, storeId);
    if (!listing) return [];

    const filter: Record<string, any> = { storeListingId: listing.id };
    if (status) filter.status = status;
    const docs = await this.storeListingDamagedUnitModel.find(filter).exec();
    return docs.map((doc: any) => ({ ...(doc.toObject?.() ?? doc), id: String(doc._id) }));
  }
}
