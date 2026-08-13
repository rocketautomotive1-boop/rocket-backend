// backend/scripts/backfill-store-listing-stock.ts
/**
 * Backfill de stock_lots/stock_balances/stock_movements ->
 * store_listing_stock_* (Fase 2 do plano StoreListing). Puramente
 * aditivo: NUNCA apaga/edita as coleções antigas do StockModule — só
 * copia. Idempotente via originalLotId/originalBalanceId/
 * originalMovementId como chave de proveniência (índice unique).
 *
 * Uso:
 *   npx ts-node scripts/backfill-store-listing-stock.ts             # dry-run
 *   npx ts-node scripts/backfill-store-listing-stock.ts --execute    # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Model, Types } from 'mongoose';
// Value imports below are `import type` on purpose: this file's Nest/app graph
// transitively pulls in the `uuid` package (ESM-only), which Jest cannot parse
// (see product-discovery.service.ts -> uuid). The exported backfill* functions
// have zero runtime dependency on Nest wiring — they only need the *types* for
// their parameter signatures — so keeping these as type-only imports lets the
// test file (`backfill-store-listing-stock.logic.spec.ts`) import them
// without ever loading AppModule. The actual runtime values are lazily
// require()'d inside main(), which only ever runs via the CLI entrypoint,
// never under Jest.
import type { StoreListingService } from '../src/store-listing/store-listing.service';
import type { StoreListingStockLotDocument } from '../src/store-listing/schemas/store-listing-stock-lot.schema';
import type { StoreListingStockBalanceDocument } from '../src/store-listing/schemas/store-listing-stock-balance.schema';
import type { StoreListingStockMovementDocument } from '../src/store-listing/schemas/store-listing-stock-movement.schema';

export interface StockLotRow {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  condition: string;
  unitCost: string;
  expiryDate?: Date;
  sourceRef?: string;
  createdByUserId: Types.ObjectId | null;
}

export interface StockBalanceRow {
  _id: Types.ObjectId;
  lotId: Types.ObjectId;
  productId: Types.ObjectId;
  condition: string;
  boxId: Types.ObjectId | null;
  onHand: number;
  reserved: number;
}

export interface StockMovementRow {
  _id: Types.ObjectId;
  lotId?: Types.ObjectId;
  productId: Types.ObjectId;
  orderId?: Types.ObjectId;
  type: string;
  quantity: number;
  date: Date;
  unitCost?: string;
  fromBoxId?: Types.ObjectId;
  toBoxId?: Types.ObjectId;
  condition: string;
  reason?: string;
  origin?: { type: string; location: string };
  metadata?: Record<string, any>;
}

export interface StockBackfillSummary {
  totalLots: number;
  lotsCreated: number;
  lotsSkippedAlreadyMigrated: number;
  storeListingsCreatedForStockOnly: number;
}

export interface RelatedBackfillSummary {
  total: number;
  created: number;
  skippedAlreadyMigrated: number;
  skippedOrphanedLotId: number;
  skippedMissingStoreListing: number;
}

export async function backfillStock(params: {
  lots: StockLotRow[];
  resolveStore: (createdByUserId: Types.ObjectId | null) => Promise<string>;
  storeListingService: Pick<StoreListingService, 'findByProductAndStore' | 'create'>;
  stockLotModel: Pick<Model<StoreListingStockLotDocument>, 'findOne' | 'create'>;
  dryRun: boolean;
}): Promise<StockBackfillSummary> {
  const { lots, resolveStore, storeListingService, stockLotModel, dryRun } = params;

  const summary: StockBackfillSummary = {
    totalLots: lots.length,
    lotsCreated: 0,
    lotsSkippedAlreadyMigrated: 0,
    storeListingsCreatedForStockOnly: 0,
  };

  for (const lot of lots) {
    const alreadyMigrated = await stockLotModel.findOne({ originalLotId: lot._id });
    if (alreadyMigrated) {
      summary.lotsSkippedAlreadyMigrated++;
      continue;
    }

    if (dryRun) continue;

    const storeId = await resolveStore(lot.createdByUserId);
    let storeListingId: string;
    const existing = await storeListingService.findByProductAndStore(String(lot.productId), storeId);
    if (existing) {
      storeListingId = existing.id;
    } else {
      const created = await storeListingService.create(String(lot.productId), storeId);
      storeListingId = created.id;
      summary.storeListingsCreatedForStockOnly++;
    }

    await stockLotModel.create({
      storeListingId,
      originalLotId: lot._id,
      condition: lot.condition,
      unitCost: lot.unitCost,
      expiryDate: lot.expiryDate,
      sourceRef: lot.sourceRef,
    });
    summary.lotsCreated++;
  }

  return summary;
}

export async function backfillBalances(params: {
  balances: StockBalanceRow[];
  storeListingIdByProductId: Map<string, string>; // pre-resolved by the lot pass, one storeId per product
  lotIdMap: Map<string, string>; // originalLotId (string) -> new store_listing_stock_lots _id (string)
  balanceModel: Pick<Model<StoreListingStockBalanceDocument>, 'findOne' | 'create'>;
  dryRun: boolean;
}): Promise<RelatedBackfillSummary> {
  const { balances, storeListingIdByProductId, lotIdMap, balanceModel, dryRun } = params;

  const summary: RelatedBackfillSummary = {
    total: balances.length,
    created: 0,
    skippedAlreadyMigrated: 0,
    skippedOrphanedLotId: 0,
    skippedMissingStoreListing: 0,
  };

  for (const balance of balances) {
    const alreadyMigrated = await balanceModel.findOne({ originalBalanceId: balance._id });
    if (alreadyMigrated) {
      summary.skippedAlreadyMigrated++;
      continue;
    }

    if (dryRun) continue;

    const storeListingId = storeListingIdByProductId.get(String(balance.productId));
    if (!storeListingId) {
      console.warn(
        `  [skip] balance ${String(balance._id)}: produto ${String(balance.productId)} sem StoreListing resolvido (lacuna de integridade).`,
      );
      summary.skippedMissingStoreListing++;
      continue;
    }

    const newLotId = lotIdMap.get(String(balance.lotId));
    if (!newLotId) {
      console.warn(
        `  [skip] balance ${String(balance._id)}: lot ${String(balance.lotId)} órfão (não migrado).`,
      );
      summary.skippedOrphanedLotId++;
      continue;
    }

    await balanceModel.create({
      storeListingId,
      lotId: newLotId,
      originalBalanceId: balance._id,
      condition: balance.condition,
      boxId: balance.boxId,
      onHand: balance.onHand,
      reserved: balance.reserved,
    });
    summary.created++;
  }

  return summary;
}

export async function backfillMovements(params: {
  movements: StockMovementRow[];
  storeListingIdByProductId: Map<string, string>;
  lotIdMap: Map<string, string>;
  movementModel: Pick<Model<StoreListingStockMovementDocument>, 'findOne' | 'create'>;
  dryRun: boolean;
}): Promise<RelatedBackfillSummary> {
  const { movements, storeListingIdByProductId, lotIdMap, movementModel, dryRun } = params;

  const summary: RelatedBackfillSummary = {
    total: movements.length,
    created: 0,
    skippedAlreadyMigrated: 0,
    skippedOrphanedLotId: 0,
    skippedMissingStoreListing: 0,
  };

  for (const movement of movements) {
    const alreadyMigrated = await movementModel.findOne({ originalMovementId: movement._id });
    if (alreadyMigrated) {
      summary.skippedAlreadyMigrated++;
      continue;
    }

    if (dryRun) continue;

    const storeListingId = storeListingIdByProductId.get(String(movement.productId));
    if (!storeListingId) {
      console.warn(
        `  [skip] movement ${String(movement._id)}: produto ${String(movement.productId)} sem StoreListing resolvido (lacuna de integridade).`,
      );
      summary.skippedMissingStoreListing++;
      continue;
    }

    let newLotId: string | undefined;
    if (movement.lotId) {
      newLotId = lotIdMap.get(String(movement.lotId));
      if (!newLotId) {
        console.warn(
          `  [skip] movement ${String(movement._id)}: lot ${String(movement.lotId)} órfão (não migrado).`,
        );
        summary.skippedOrphanedLotId++;
        continue;
      }
    }

    await movementModel.create({
      storeListingId,
      lotId: newLotId,
      originalMovementId: movement._id,
      orderId: movement.orderId,
      type: movement.type,
      quantity: movement.quantity,
      date: movement.date,
      unitCost: movement.unitCost,
      fromBoxId: movement.fromBoxId,
      toBoxId: movement.toBoxId,
      condition: movement.condition,
      reason: movement.reason,
      origin: movement.origin,
      metadata: movement.metadata,
    });
    summary.created++;
  }

  return summary;
}

async function main() {
  // Lazily required: pulling these in at module scope would drag AppModule's
  // full dependency graph (including the ESM-only `uuid` package) into every
  // consumer of this file, including the Jest tests for backfillStock/
  // backfillBalances/backfillMovements. See the comment on the type-only
  // imports above.
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingService } = require('../src/store-listing/store-listing.service');
  const { StoreService } = require('../src/store/services/store.service');
  const { StockLotModel } = require('../src/stock/schemas/stock-lot.schema');
  const { StockBalanceModel } = require('../src/stock/schemas/stock-balance.schema');
  const { StockMovementModel } = require('../src/stock/schemas/stock-movement.schema');
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const {
    StoreListingStockBalanceModel,
  } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const {
    StoreListingStockMovementModel,
  } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');
  const { UserModel } = require('../src/auth/schemas/user.schema');
  const { ProductModel } = require('../src/product/schemas/product.schema');
  const { resolveOwnerStore } = require('../src/store-listing/resolve-owner-store');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const storeListingService = app.get(StoreListingService);
    const storeService = app.get(StoreService);
    const stockLotModel = app.get(getModelToken(StockLotModel.name)) as Model<any>;
    const stockBalanceModel = app.get(getModelToken(StockBalanceModel.name)) as Model<any>;
    const stockMovementModel = app.get(getModelToken(StockMovementModel.name)) as Model<any>;
    const newLotModel = app.get(
      getModelToken(StoreListingStockLotModel.name),
    ) as Model<StoreListingStockLotDocument>;
    const newBalanceModel = app.get(
      getModelToken(StoreListingStockBalanceModel.name),
    ) as Model<StoreListingStockBalanceDocument>;
    const newMovementModel = app.get(
      getModelToken(StoreListingStockMovementModel.name),
    ) as Model<StoreListingStockMovementDocument>;
    const userModel = app.get(getModelToken(UserModel.name)) as Model<any>;
    const productModel = app.get(getModelToken(ProductModel.name)) as Model<any>;

    const fallbackStore = await storeService.findByName('Rocket Automotive');
    if (!fallbackStore) {
      throw new Error("Loja padrão 'Rocket Automotive' não encontrada — não deveria acontecer em produção.");
    }

    const resolveStore = async (createdByUserId: Types.ObjectId | null): Promise<string> =>
      resolveOwnerStore({
        createdByUserId,
        fallbackStoreId: fallbackStore.id,
        userStoreIdLookup: async (userId: string) => {
          const user = await userModel.findById(userId).lean().exec();
          return user?.storeId ?? null;
        },
      });

    // Fase 1: lots (constrói Map<originalLotId, newLotId> e
    // Map<productId, storeListingId> — necessários pros passos de
    // balance/movement referenciarem o novo lot/StoreListing sem
    // reresolver loja por produto).
    const allLots = await stockLotModel.find().lean().exec();
    const products = await productModel
      .find({ _id: { $in: allLots.map((l: any) => l.productId) } }, { createdByUserId: 1 })
      .lean()
      .exec();
    const createdByUserIdByProductId = new Map(
      products.map((p: any) => [String(p._id), p.createdByUserId ?? null]),
    );

    const lotRows: StockLotRow[] = allLots.map((l: any) => ({
      _id: l._id,
      productId: l.productId,
      condition: l.condition,
      unitCost: l.unitCost.toString(),
      expiryDate: l.expiryDate,
      sourceRef: l.sourceRef,
      createdByUserId: createdByUserIdByProductId.get(String(l.productId)) ?? null,
    }));

    const lotSummary = await backfillStock({
      lots: lotRows,
      resolveStore,
      storeListingService,
      stockLotModel: newLotModel,
      dryRun,
    });

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Lots:`, lotSummary);

    if (dryRun) {
      console.log('\n[DRY-RUN] Balances/Movements não avaliados em dry-run (dependem dos lots gravados).');
      return;
    }

    // storeListingIdByProductId: reresolve por produto (barato, cache em
    // memória) em vez de reaproveitar direto do loop acima porque nem todo
    // produto com balance/movement necessariamente teve um lot processado
    // nesta mesma execução (idempotência entre corridas separadas).
    const storeListingIdByProductId = new Map<string, string>();
    for (const [productId, createdByUserId] of createdByUserIdByProductId as Map<string, Types.ObjectId | null>) {
      const storeId = await resolveStore(createdByUserId);
      const existing = await storeListingService.findByProductAndStore(productId, storeId);
      if (existing) storeListingIdByProductId.set(productId, existing.id);
    }

    // lotIdMap: originalLotId (string) -> new store_listing_stock_lots _id
    // (string). Reconstruído via query em vez de acumulado durante o loop
    // de backfillStock porque lots já migrados em execuções anteriores
    // (idempotência) não passam pelo `create` deste run.
    const migratedLots = await newLotModel
      .find({ originalLotId: { $in: allLots.map((l: any) => l._id) } }, { originalLotId: 1 })
      .lean()
      .exec();
    const lotIdMap = new Map(migratedLots.map((l: any) => [String(l.originalLotId), String(l._id)]));

    const allBalances = await stockBalanceModel.find().lean().exec();
    const balanceRows: StockBalanceRow[] = allBalances.map((b: any) => ({
      _id: b._id,
      lotId: b.lotId,
      productId: b.productId,
      condition: b.condition,
      boxId: b.boxId ?? null,
      onHand: b.onHand,
      reserved: b.reserved,
    }));

    const balanceSummary = await backfillBalances({
      balances: balanceRows,
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: newBalanceModel,
      dryRun,
    });

    console.log('Balances:', balanceSummary);

    const allMovements = await stockMovementModel.find().lean().exec();
    const movementRows: StockMovementRow[] = allMovements.map((m: any) => ({
      _id: m._id,
      lotId: m.lotId,
      productId: m.productId,
      orderId: m.orderId,
      type: m.type,
      quantity: m.quantity,
      date: m.date,
      unitCost: m.unitCost?.toString(),
      fromBoxId: m.fromBoxId,
      toBoxId: m.toBoxId,
      condition: m.condition,
      reason: m.reason,
      origin: m.origin,
      metadata: m.metadata,
    }));

    const movementSummary = await backfillMovements({
      movements: movementRows,
      storeListingIdByProductId,
      lotIdMap,
      movementModel: newMovementModel,
      dryRun,
    });

    console.log('Movements:', movementSummary);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
