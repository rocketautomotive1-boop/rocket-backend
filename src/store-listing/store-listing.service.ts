import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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
import { BoxModel } from '../product/schemas/box.schema';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { StoreListingPort } from './ports/store-listing.port';
import { StockMovementType } from '../stock/domain/movement-type';
import { StockCondition } from '../stock/domain/movement-type';
import { computeBalanceDelta } from '../stock/domain/balance.calculator';
import { weightedAverageCost } from '../stock/domain/average-cost';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';

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
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    @Inject(STOCK_QUERY_PORT)
    private readonly stockQuery: StockQueryPort,
    @Inject(PRICING_PORT)
    private readonly pricing: PricingPort,
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

  /**
   * session opcional: quando informada, todas as operações Mongo (lote, saldo, movimento)
   * participam da transação do chamador — usado por StockService.moveOnce (Contract, escrita
   * primária). Sem session (chamadas fora de uma transação, ex. mirror antigo pós-commit),
   * comportamento igual a antes.
   */
  async recordStockMovement(
    params: {
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
      /** Idempotency key — grava em metadata.externalReference (lido por referenceExists/findExistingReferences). */
      reference?: string;
      /** Preço de venda vigente (nunca no unitCost, que é custo do lote). */
      salePrice?: number;
    },
    session?: ClientSession,
  ): Promise<{ lotId: string; movementId: string }> {
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
      ? await this.storeListingStockLotModel.findById(params.lotId).session(session ?? null).exec()
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
            { upsert: true, new: true, session },
          )
          .exec();

    const lotId: Types.ObjectId = (resolvedLot as any)._id;
    const boxIdRaw = params.toBoxId ?? params.fromBoxId ?? null;
    const boxId = boxIdRaw ? new Types.ObjectId(boxIdRaw) : null;
    const delta = computeBalanceDelta(params.type, params.quantity);
    const unitCostNumber = params.unitCost != null ? Number(params.unitCost) : 0;

    // Weighted-average cost on inbound with a positive cost — fecha o gap: antes desta mudança,
    // unitCost só era gravado na CRIAÇÃO do lote ($setOnInsert), nunca recalculado em entradas
    // subsequentes, divergindo silenciosamente do legado (que já recalculava corretamente).
    if (params.type === StockMovementType.INBOUND && unitCostNumber > 0) {
      const totals = await this.storeListingStockBalanceModel
        .aggregate([{ $match: { lotId } }, { $group: { _id: '$lotId', onHand: { $sum: '$onHand' } } }])
        .session(session ?? null);
      const existingQty = totals[0]?.onHand ?? 0;
      const existingAvg = Number((resolvedLot as any).unitCost?.toString() ?? 0);
      const newAvg = weightedAverageCost(existingQty, existingAvg, params.quantity, unitCostNumber);
      await this.storeListingStockLotModel.updateOne(
        { _id: lotId },
        { $set: { unitCost: String(newAvg) } },
        { session },
      );
    }

    // Atomic upsert mirroring StockRepository.applyBalanceDelta: keyed by
    // {storeListingId, lotId, boxId} (condition only set on insert), no
    // separate find-then-branch — $inc is race-safe under concurrent writes.
    await this.storeListingStockBalanceModel.updateOne(
      { storeListingId, lotId, boxId },
      { $inc: { onHand: delta.onHand, reserved: delta.reserved }, $setOnInsert: { condition } },
      { upsert: true, session },
    );

    const [movement] = await this.storeListingStockMovementModel.create(
      [
        {
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
          metadata:
            params.reference != null || params.salePrice != null
              ? {
                  ...(params.reference != null ? { externalReference: params.reference } : {}),
                  ...(params.salePrice != null ? { salePrice: params.salePrice } : {}),
                }
              : undefined,
          // originalMovementId deliberately omitted — this is a net-new movement, not migrated.
        },
      ],
      { session },
    );

    return { lotId: String(lotId), movementId: String((movement as any)._id) };
  }

  /**
   * onHand somado de um (productId, storeId, condition) — usado por StockService.correctTo
   * (Contract) para calcular o diff contra o alvo. Sem StoreListing para o par → 0.
   */
  async getConditionOnHand(productId: string, storeId: string, condition: StockCondition): Promise<number> {
    const storeListing = await this.findByProductAndStore(productId, storeId);
    if (!storeListing) return 0;
    const rows = await this.storeListingStockBalanceModel.aggregate([
      { $match: { storeListingId: new Types.ObjectId(storeListing.id), condition } },
      { $group: { _id: null, onHand: { $sum: '$onHand' } } },
    ]);
    return rows[0]?.onHand ?? 0;
  }

  /**
   * True se já existe um movimento com esse metadata.externalReference — usado por
   * StockService.moveOnce (Contract) para checar idempotência antes de gravar.
   */
  async referenceExists(reference: string, session?: ClientSession): Promise<boolean> {
    const c = await this.storeListingStockMovementModel
      .countDocuments({ 'metadata.externalReference': reference })
      .session(session ?? null);
    return c > 0;
  }

  /**
   * Usado por StockService.reverseMovement/editMovementViaAdjustment (Contract): busca um
   * movimento pelo seu próprio _id e resolve o storeId da loja dona via o StoreListing
   * associado — StockService precisa desses dois campos (type/quantity para calcular o delta
   * de compensação, storeId para chamar adjust()) e não deve acessar os models diretamente.
   */
  async findMovementById(
    movementId: string,
  ): Promise<
    | {
        type: StockMovementType;
        quantity: number;
        condition: StockCondition;
        productId: string;
        storeId: string;
        toBoxId?: string;
        fromBoxId?: string;
      }
    | null
  > {
    const movement = await this.storeListingStockMovementModel.findById(movementId).lean().exec();
    if (!movement) return null;
    const storeListing = await this.storeListingModel.findById((movement as any).storeListingId).lean().exec();
    if (!storeListing) return null;
    return {
      type: (movement as any).type,
      quantity: (movement as any).quantity,
      condition: (movement as any).condition,
      productId: String((storeListing as any).productId),
      storeId: String((storeListing as any).storeId),
      toBoxId: (movement as any).toBoxId ? String((movement as any).toBoxId) : undefined,
      fromBoxId: (movement as any).fromBoxId ? String((movement as any).fromBoxId) : undefined,
    };
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

  private readonly PRODUCT_SELECT = 'partNumber price costPrice listPrice brands images sku slug';

  /** Resolve a allocation e confirma que o warehouse dela pertence à loja. NotFoundException se não. */
  private async resolveAllocationInStore(storeId: string, allocationId: string): Promise<AllocationDocument> {
    if (!Types.ObjectId.isValid(allocationId)) throw new NotFoundException('Alocação não encontrada');
    const allocation = await this.allocationModel.findById(allocationId).exec();
    if (!allocation) throw new NotFoundException('Alocação não encontrada');
    const warehouse = await this.storeListingWarehouseModel.findById(allocation.warehouseId).exec();
    if (!warehouse || String((warehouse as any).storeId) !== String(storeId)) {
      throw new NotFoundException('Alocação não encontrada');
    }
    return allocation;
  }

  /** Resolve a allocation dona de um box e confirma a loja, dado o id do box. */
  private async resolveAllocationByBoxId(storeId: string, boxId: string): Promise<AllocationDocument> {
    if (!Types.ObjectId.isValid(boxId)) throw new NotFoundException('Box não encontrado');
    const allocation = await this.allocationModel.findOne({ 'boxes._id': new Types.ObjectId(boxId) }).exec();
    if (!allocation) throw new NotFoundException('Box não encontrado');
    const warehouse = await this.storeListingWarehouseModel.findById(allocation.warehouseId).exec();
    if (!warehouse || String((warehouse as any).storeId) !== String(storeId)) {
      throw new NotFoundException('Box não encontrado');
    }
    return allocation;
  }

  private generateBoxCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 22; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  private toBoxWithContext(box: any, allocation: AllocationDocument) {
    const boxObj = box.toObject ? box.toObject() : JSON.parse(JSON.stringify(box));
    return { ...boxObj, id: String(box._id), allocationId: String(allocation._id), warehouseId: String(allocation.warehouseId) };
  }

  async createBox(
    storeId: string,
    allocationId: string,
    params: { code?: string; description?: string },
  ): Promise<BoxModel & { id: string; allocationId: string }> {
    const allocation = await this.resolveAllocationInStore(storeId, allocationId);
    const code = params.code || this.generateBoxCode();
    const box: any = { code, description: params.description, itemsCount: 0, products: [] };
    try {
      allocation.boxes.push(box as BoxModel);
      await allocation.save();
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('Já existe um box com este código.');
      throw err;
    }
    const created = allocation.boxes[allocation.boxes.length - 1];
    return this.toBoxWithContext(created, allocation);
  }

  async listBoxes(
    storeId: string,
  ): Promise<Array<BoxModel & { id: string; allocationId: string; warehouseId: string }>> {
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    if (warehouseIds.length === 0) return [];
    const allocations = await this.allocationModel.find({ warehouseId: { $in: warehouseIds } }).exec();
    const out: any[] = [];
    for (const allocation of allocations) {
      for (const box of allocation.boxes) out.push(this.toBoxWithContext(box, allocation));
    }
    return out;
  }

  async getBox(
    storeId: string,
    boxId: string,
  ): Promise<BoxModel & { id: string; allocationId: string; warehouseId: string }> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const box = allocation.boxes.find((b) => String((b as any)._id) === String(boxId));
    return this.toBoxWithContext(box, allocation);
  }

  async getBoxByCode(
    storeId: string,
    code: string,
  ): Promise<BoxModel & { id: string; allocationId: string; warehouseId: string }> {
    // QR readers may return the box's _id (e.g. from an older code or a raw ID scan) instead of
    // the generated `code` — same tolerance as scanBox, since a real code is never a valid ObjectId.
    if (Types.ObjectId.isValid(code) && /^[a-fA-F0-9]{24}$/.test(code)) {
      return this.getBox(storeId, code);
    }
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    if (warehouseIds.length === 0) throw new NotFoundException('Box não encontrado');
    const allocation = await this.allocationModel
      .findOne({ warehouseId: { $in: warehouseIds }, 'boxes.code': code })
      .exec();
    if (!allocation) throw new NotFoundException('Box não encontrado');
    const box = allocation.boxes.find((b) => b.code === code);
    return this.toBoxWithContext(box, allocation);
  }

  async updateBox(
    storeId: string,
    boxId: string,
    patch: { code?: string; description?: string },
  ): Promise<BoxModel & { id: string }> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const box: any = allocation.boxes.find((b) => String((b as any)._id) === String(boxId));
    if (patch.code) box.code = patch.code;
    if (patch.description !== undefined) box.description = patch.description;
    try {
      await allocation.save();
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('Já existe um box com este código.');
      throw err;
    }
    return this.toBoxWithContext(box, allocation);
  }

  async removeBox(storeId: string, boxId: string): Promise<void> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    allocation.boxes = allocation.boxes.filter((b) => String((b as any)._id) !== String(boxId)) as any;
    await allocation.save();
  }

  private async withProducts(box: any, allocation: AllocationDocument) {
    const boxWithContext = this.toBoxWithContext(box, allocation);
    const productIds = (box.products || []).map((p: any) => String(p));
    const products = productIds.length
      ? await this.productModel.find({ _id: { $in: productIds } }).select(this.PRODUCT_SELECT).lean().exec()
      : [];
    return { box: boxWithContext, products };
  }

  async getBoxProducts(storeId: string, boxId: string): Promise<{ box: BoxModel & { id: string }; products: any[] }> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const box = allocation.boxes.find((b) => String((b as any)._id) === String(boxId));
    return this.withProducts(box, allocation);
  }

  async getBoxProductsByCode(
    storeId: string,
    code: string,
  ): Promise<{ box: BoxModel & { id: string }; products: any[] }> {
    const box = await this.getBoxByCode(storeId, code);
    const allocation = await this.resolveAllocationByBoxId(storeId, (box as any).id);
    return this.withProducts(box, allocation);
  }

  async addProductToBox(storeId: string, boxId: string, productId: string): Promise<BoxModel & { id: string }> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    const productObjId = new Types.ObjectId(productId);

    // Um produto só pode estar em um box por vez — remove de qualquer outro box da loja antes.
    await this.allocationModel
      .updateMany(
        { warehouseId: { $in: warehouseIds }, 'boxes.products': productObjId },
        { $pull: { 'boxes.$[].products': productObjId } },
      )
      .exec();

    // Re-busca a allocation-alvo: o updateMany acima pode ter alterado seu próprio documento (boxes.$[]).
    const target = (await this.allocationModel.findById(allocation._id).exec())!;
    const box: any = target.boxes.find((b) => String((b as any)._id) === boxId);
    if (!box.products.some((p: any) => String(p) === String(productObjId))) {
      box.products.push(productObjId);
    }
    target.markModified('boxes');
    await target.save();
    return this.toBoxWithContext(box, target);
  }

  async removeProductFromBox(storeId: string, boxId: string, productId: string): Promise<BoxModel & { id: string }> {
    const allocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const box: any = allocation.boxes.find((b) => String((b as any)._id) === String(boxId));
    box.products = (box.products || []).filter((p: any) => String(p) !== String(productId));
    allocation.markModified('boxes');
    await allocation.save();
    return this.toBoxWithContext(box, allocation);
  }

  async linkBoxToAllocation(
    storeId: string,
    boxId: string,
    targetAllocationId: string,
  ): Promise<BoxModel & { id: string; allocationId: string }> {
    const sourceAllocation = await this.resolveAllocationByBoxId(storeId, boxId);
    const targetAllocation = await this.resolveAllocationInStore(storeId, targetAllocationId);

    if (String(sourceAllocation._id) === String(targetAllocation._id)) {
      const box = sourceAllocation.boxes.find((b) => String((b as any)._id) === String(boxId));
      return this.toBoxWithContext(box, sourceAllocation);
    }

    const idx = sourceAllocation.boxes.findIndex((b) => String((b as any)._id) === String(boxId));
    const box: any = sourceAllocation.boxes[idx];
    sourceAllocation.boxes.splice(idx, 1);
    await sourceAllocation.save();

    targetAllocation.boxes.push(box);
    await targetAllocation.save();
    const moved = targetAllocation.boxes[targetAllocation.boxes.length - 1];
    return this.toBoxWithContext(moved, targetAllocation);
  }

  async scanBox(
    storeId: string,
    qr: string,
    allocationId: string,
  ): Promise<{ box: BoxModel & { id: string; allocationId: string }; isNew: boolean }> {
    const trimmed = (qr ?? '').trim();
    if (!trimmed) throw new BadRequestException('QR Code vazio');

    let code: string;
    if (Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
      const allocation = await this.resolveAllocationByBoxId(storeId, trimmed).catch(() => null);
      if (allocation) {
        const linked = await this.linkBoxToAllocation(storeId, trimmed, allocationId);
        return { box: linked, isNew: false };
      }
      code = trimmed;
    } else {
      const match = trimmed.match(/CODE=([A-Za-z0-9]+)/i);
      code = match ? match[1] : trimmed;
    }

    const existing = await this.getBoxByCode(storeId, code).catch(() => null);
    if (existing) {
      const linked = await this.linkBoxToAllocation(storeId, (existing as any).id, allocationId);
      return { box: linked, isNew: false };
    }

    const created = await this.createBox(storeId, allocationId, { code });
    return { box: created, isNew: true };
  }

  async getAllocation(storeId: string, allocationId: string): Promise<AllocationModel & { id: string }> {
    const allocation = await this.resolveAllocationInStore(storeId, allocationId);
    return { ...allocation.toObject(), id: String(allocation._id) };
  }

  private readonly ALLOCATION_PRODUCT_SELECT = 'partNumber price costPrice listPrice brands images sku';

  async getAllocationProducts(
    storeId: string,
    allocationId: string,
  ): Promise<{
    allocation: AllocationModel & { id: string };
    boxes: any[];
    totals: { totalBoxes: number; totalItems: number; totalValue: number };
  }> {
    const allocation = await this.resolveAllocationInStore(storeId, allocationId);
    const rawBoxes: any[] = allocation.boxes || [];

    const allProductIds = rawBoxes.flatMap((box) => (box.products || []).map((p: any) => String(p)));
    const uniqueIds = [...new Set(allProductIds)];
    const products = uniqueIds.length
      ? await this.productModel.find({ _id: { $in: uniqueIds } }).select(this.ALLOCATION_PRODUCT_SELECT).lean().exec()
      : [];
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    let totalItems = 0;
    let totalValue = 0;

    const boxes = await Promise.all(
      rawBoxes.map(async (box: any) => {
        const matchedProducts = (box.products || [])
          .map((pid: any) => productMap.get(String(pid)))
          .filter(Boolean);

        const boxProducts = await Promise.all(
          matchedProducts.map(async (p: any) => {
            const pid = String(p._id);
            const quantity = Math.max((await this.stockQuery.getProductStock(pid)).onHand, 1);
            const costPrice = (await this.stockQuery.getProductCost(pid)) || 0;
            const price = await this.pricing.getBasePrice(pid);

            totalItems += quantity;
            totalValue += price * quantity;
            return { ...p, id: pid, price, costPrice, quantity };
          }),
        );

        return {
          id: String(box._id),
          _id: String(box._id),
          code: box.code,
          description: box.description,
          itemsCount: box.itemsCount || 0,
          products: boxProducts,
          boxTotal: boxProducts.reduce((sum: number, p: any) => sum + p.price * p.quantity, 0),
          boxItemCount: boxProducts.reduce((sum: number, p: any) => sum + p.quantity, 0),
        };
      }),
    );

    return {
      allocation: {
        ...allocation.toObject(),
        id: String(allocation._id),
      },
      boxes,
      totals: { totalBoxes: rawBoxes.length, totalItems, totalValue },
    };
  }

  private parseAllocationQr(qr: string): { locationPath?: string; allocationId?: string; metadata?: Record<string, any> } {
    const trimmed = (qr ?? '').trim();
    if (!trimmed) throw new BadRequestException('QR Code vazio');

    if (Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) {
      return { allocationId: trimmed };
    }

    if (trimmed.includes('/') && !trimmed.toUpperCase().startsWith('ALLOC')) {
      return { locationPath: trimmed };
    }

    const parts = trimmed.split(';').map((p) => p.trim());
    if (!parts[0] || !parts[0].toUpperCase().startsWith('ALLOC')) {
      throw new BadRequestException(
        'QR Code inválido para Allocation. Formatos aceitos: ObjectId, locationPath (ex: F1/R2/ROW3/S1/L1), ou ALLOC;PATH=...',
      );
    }

    let locationPath = '';
    const metadata: Record<string, any> = {};
    for (let i = 1; i < parts.length; i++) {
      const [key, value] = parts[i].split('=');
      if (!key) continue;
      const k = key.toUpperCase();
      const v = (value ?? '').trim();
      if (k === 'PATH') locationPath = v;
      else metadata[k.toLowerCase()] = v;
    }

    if (!locationPath && Object.keys(metadata).length > 0) {
      const p: string[] = [];
      if (metadata.floor) p.push(`F${metadata.floor}`);
      if (metadata.room) p.push(`R${metadata.room}`);
      if (metadata.row) p.push(`ROW${metadata.row}`);
      if (metadata.shelf) p.push(`S${metadata.shelf}`);
      if (metadata.level) p.push(`L${metadata.level}`);
      locationPath = p.join('/');
    }

    if (!locationPath) throw new BadRequestException('Não foi possível identificar o caminho de alocação pelo QR');
    return { locationPath, metadata };
  }

  async scanAllocation(
    storeId: string,
    qr: string,
    dryRun: boolean,
  ): Promise<{ allocation: (AllocationModel & { id: string }) | null; isNew: boolean; parsed?: { locationPath?: string; metadata?: Record<string, any> } }> {
    const parsed = this.parseAllocationQr(qr);

    if (parsed.allocationId) {
      const allocation = await this.resolveAllocationInStore(storeId, parsed.allocationId).catch(() => null);
      if (!allocation) throw new NotFoundException('Alocação não encontrada para o ID informado');
      return { allocation: { ...allocation.toObject(), id: String(allocation._id) }, isNew: false };
    }

    const { locationPath, metadata } = parsed;
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    const existing = warehouseIds.length
      ? await this.allocationModel.findOne({ warehouseId: { $in: warehouseIds }, locationPath }).exec()
      : null;

    if (existing) {
      return { allocation: { ...existing.toObject(), id: String(existing._id) }, isNew: false };
    }

    if (dryRun) {
      return { allocation: null, isNew: true, parsed: { locationPath, metadata } };
    }

    if (warehouseIds.length === 0) {
      throw new BadRequestException('Nenhum depósito configurado para esta loja — não é possível criar alocação via scan.');
    }

    try {
      const created = await this.allocationModel.create({
        warehouseId: warehouseIds[0],
        locationPath,
        metadata: metadata ?? {},
        available: true,
        active: true,
      });
      return { allocation: { ...created.toObject(), id: String(created._id) }, isNew: true };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException('Já existe uma alocação com este caminho neste depósito.');
      }
      throw err;
    }
  }

  async getBoxesByProduct(storeId: string, productId: string): Promise<any[]> {
    const warehouses = await this.storeListingWarehouseModel.find({ storeId }).select('_id').lean().exec();
    const warehouseIds = warehouses.map((w) => w._id);
    if (warehouseIds.length === 0) return [];
    const productObjId = new Types.ObjectId(productId);
    const allocations = await this.allocationModel
      .find({ warehouseId: { $in: warehouseIds }, 'boxes.products': productObjId })
      .exec();
    const out: any[] = [];
    for (const allocation of allocations) {
      for (const box of allocation.boxes as any[]) {
        if ((box.products || []).some((p: any) => String(p) === String(productObjId))) {
          const boxObj = box.toObject ? box.toObject() : JSON.parse(JSON.stringify(box));
          out.push({
            box: {
              ...boxObj,
              allocation: {
                id: String(allocation._id),
                warehouseId: String(allocation.warehouseId),
                locationPath: allocation.locationPath,
                metadata: allocation.metadata,
              },
            },
            productId: String(productId),
          });
        }
      }
    }
    return out;
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
