// backend/scripts/dedupe-store-listing-stock-lots.ts
/**
 * Corrige a duplicação de store_listing_stock_lots/balances produzida pelo
 * backfill de Fase 2 (backfill-store-listing-stock.ts) quando rodou mais de
 * uma vez sobre um (storeListingId, condition) que já tinha um lote criado
 * organicamente via StoreListingService.recordStockMovement (dual-write, sem
 * originalLotId). O índice unique-sparse em originalLotId não protege esse
 * caso — só compara documentos onde o campo está presente — então cada
 * corrida criava um segundo lote para o mesmo par, e recordStockMovement
 * (findOneAndUpdate sem esse guard, na versão pré-fix) podia gravar saldo no
 * lote "errado" quando mais de um existia, inflando onHand.
 *
 * Fix estrutural (índice unique real em {storeListingId, condition}, ver
 * schemas/store-listing-stock-lot.schema.ts) impede reincidência — este
 * script só limpa os dados já duplicados antes do fix.
 *
 * Puramente consolidador: nunca perde onHand (soma os saldos duplicados no
 * lote sobrevivente) e nunca perde histórico (reponta movements do lote
 * removido pro lote mantido, não deleta movements).
 *
 * Uso:
 *   npx ts-node scripts/dedupe-store-listing-stock-lots.ts             # dry-run
 *   npx ts-node scripts/dedupe-store-listing-stock-lots.ts --execute    # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { StoreListingStockLotDocument } from '../src/store-listing/schemas/store-listing-stock-lot.schema';
import type { StoreListingStockBalanceDocument } from '../src/store-listing/schemas/store-listing-stock-balance.schema';
import type { StoreListingStockMovementDocument } from '../src/store-listing/schemas/store-listing-stock-movement.schema';

export interface LotRow {
  _id: Types.ObjectId;
  storeListingId: Types.ObjectId;
  condition: string;
  originalLotId?: Types.ObjectId;
  createdAt: Date;
}

export interface BalanceRow {
  _id: Types.ObjectId;
  storeListingId: Types.ObjectId;
  lotId: Types.ObjectId;
  boxId: Types.ObjectId | null;
  onHand: number;
  reserved: number;
  originalBalanceId?: Types.ObjectId;
  createdAt?: Date;
}

export interface MovementRow {
  _id: Types.ObjectId;
  storeListingId: Types.ObjectId;
  lotId?: Types.ObjectId;
  quantity: number;
}

export interface BalanceMergePlan {
  boxId: Types.ObjectId | null;
  keepBalanceId: Types.ObjectId;
  removeBalanceIds: Types.ObjectId[];
  onHand: number;
  reserved: number;
}

export interface LotGroupPlan {
  storeListingId: Types.ObjectId;
  condition: string;
  keepLotId: Types.ObjectId;
  removeLotIds: Types.ObjectId[];
  balancePlan: BalanceMergePlan[];
  movementsToRepoint: Types.ObjectId[];
}

export interface DedupePlan {
  groups: LotGroupPlan[];
}

function pickSurvivor(lots: LotRow[]): LotRow {
  // Prefer a migrated lot (originalLotId set) — it carries provenance to the legacy
  // stock_lots collection, which the organic (dual-write) lot never has. Among lots
  // in the same migration state, keep the oldest (createdAt) for determinism.
  const migrated = lots.filter((l) => l.originalLotId != null);
  const pool = migrated.length > 0 ? migrated : lots;
  return [...pool].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

export function planLotDedupe(params: {
  lots: LotRow[];
  balances: BalanceRow[];
  movements: MovementRow[];
}): DedupePlan {
  const { lots, balances, movements } = params;

  const byGroup = new Map<string, LotRow[]>();
  for (const lot of lots) {
    const key = `${lot.storeListingId.toString()}:${lot.condition}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(lot);
    byGroup.set(key, arr);
  }

  const groups: LotGroupPlan[] = [];

  for (const [, groupLots] of byGroup) {
    if (groupLots.length <= 1) continue;

    const survivor = pickSurvivor(groupLots);
    const removeLotIds = groupLots.filter((l) => !l._id.equals(survivor._id)).map((l) => l._id);
    const removeLotIdSet = new Set(removeLotIds.map(String));
    const groupLotIdSet = new Set(groupLots.map((l) => String(l._id)));

    const groupBalances = balances.filter((b) => groupLotIdSet.has(String(b.lotId)));
    const byBox = new Map<string, BalanceRow[]>();
    for (const bal of groupBalances) {
      const key = bal.boxId ? bal.boxId.toString() : 'null';
      const arr = byBox.get(key) ?? [];
      arr.push(bal);
      byBox.set(key, arr);
    }

    const balancePlan: BalanceMergePlan[] = [];
    for (const [, boxBalances] of byBox) {
      if (boxBalances.length === 0) continue;
      // Same survivor preference as lots: prefer a migrated balance (originalBalanceId set),
      // else the oldest by createdAt — deterministic, matches which balance keeps its _id
      // (and therefore any external references) after the merge.
      const migrated = boxBalances.filter((b) => b.originalBalanceId != null);
      const pool = migrated.length > 0 ? migrated : boxBalances;
      const keepBalance = [...pool].sort(
        (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
      )[0];
      const removeBalanceIds = boxBalances.filter((b) => !b._id.equals(keepBalance._id)).map((b) => b._id);
      const onHand = boxBalances.reduce((sum, b) => sum + b.onHand, 0);
      const reserved = boxBalances.reduce((sum, b) => sum + b.reserved, 0);

      balancePlan.push({
        boxId: keepBalance.boxId,
        keepBalanceId: keepBalance._id,
        removeBalanceIds,
        onHand,
        reserved,
      });
    }

    const movementsToRepoint = movements
      .filter((m) => m.lotId != null && removeLotIdSet.has(String(m.lotId)))
      .map((m) => m._id);

    groups.push({
      storeListingId: survivor.storeListingId,
      condition: survivor.condition,
      keepLotId: survivor._id,
      removeLotIds,
      balancePlan,
      movementsToRepoint,
    });
  }

  return { groups };
}

export interface DedupeExecutionSummary {
  groupsProcessed: number;
  lotsRemoved: number;
  balancesMerged: number;
  balancesRemoved: number;
  movementsRepointed: number;
}

export async function applyLotDedupe(params: {
  plan: DedupePlan;
  lotModel: Pick<Model<StoreListingStockLotDocument>, 'deleteMany'>;
  balanceModel: Pick<Model<StoreListingStockBalanceDocument>, 'updateOne' | 'deleteMany'>;
  movementModel: Pick<Model<StoreListingStockMovementDocument>, 'updateMany'>;
  dryRun: boolean;
}): Promise<DedupeExecutionSummary> {
  const { plan, lotModel, balanceModel, movementModel, dryRun } = params;

  const summary: DedupeExecutionSummary = {
    groupsProcessed: plan.groups.length,
    lotsRemoved: 0,
    balancesMerged: 0,
    balancesRemoved: 0,
    movementsRepointed: 0,
  };

  for (const group of plan.groups) {
    for (const bal of group.balancePlan) {
      summary.balancesMerged++;
      summary.balancesRemoved += bal.removeBalanceIds.length;
      if (dryRun) continue;

      await balanceModel.updateOne(
        { _id: bal.keepBalanceId },
        { $set: { onHand: bal.onHand, reserved: bal.reserved } },
      );
      if (bal.removeBalanceIds.length > 0) {
        await balanceModel.deleteMany({ _id: { $in: bal.removeBalanceIds } });
      }
    }

    if (group.movementsToRepoint.length > 0) {
      summary.movementsRepointed += group.movementsToRepoint.length;
      if (!dryRun) {
        await movementModel.updateMany(
          { _id: { $in: group.movementsToRepoint } },
          { $set: { lotId: group.keepLotId } },
        );
      }
    }

    summary.lotsRemoved += group.removeLotIds.length;
    if (!dryRun && group.removeLotIds.length > 0) {
      await lotModel.deleteMany({ _id: { $in: group.removeLotIds } });
    }
  }

  return summary;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const {
    StoreListingStockBalanceModel,
  } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const {
    StoreListingStockMovementModel,
  } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const lotModel = app.get(getModelToken(StoreListingStockLotModel.name)) as Model<StoreListingStockLotDocument>;
    const balanceModel = app.get(
      getModelToken(StoreListingStockBalanceModel.name),
    ) as Model<StoreListingStockBalanceDocument>;
    const movementModel = app.get(
      getModelToken(StoreListingStockMovementModel.name),
    ) as Model<StoreListingStockMovementDocument>;

    const lots: LotRow[] = (await lotModel.find().lean().exec()).map((l: any) => ({
      _id: l._id,
      storeListingId: l.storeListingId,
      condition: l.condition,
      originalLotId: l.originalLotId,
      createdAt: l.createdAt,
    }));
    const balances: BalanceRow[] = (await balanceModel.find().lean().exec()).map((b: any) => ({
      _id: b._id,
      storeListingId: b.storeListingId,
      lotId: b.lotId,
      boxId: b.boxId ?? null,
      onHand: b.onHand,
      reserved: b.reserved,
      originalBalanceId: b.originalBalanceId,
      createdAt: b.createdAt,
    }));
    const movements: MovementRow[] = (await movementModel.find({}, { storeListingId: 1, lotId: 1, quantity: 1 }).lean().exec()).map(
      (m: any) => ({ _id: m._id, storeListingId: m.storeListingId, lotId: m.lotId, quantity: m.quantity }),
    );

    const plan = planLotDedupe({ lots, balances, movements });

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Grupos duplicados encontrados: ${plan.groups.length}`);
    for (const group of plan.groups) {
      console.log(
        `  storeListing=${group.storeListingId} condition=${group.condition} keep=${group.keepLotId} remove=[${group.removeLotIds.join(', ')}] movementsToRepoint=${group.movementsToRepoint.length}`,
      );
      for (const bal of group.balancePlan) {
        console.log(
          `    box=${bal.boxId ?? 'null'} keepBalance=${bal.keepBalanceId} removeBalances=[${bal.removeBalanceIds.join(', ')}] onHand->${bal.onHand} reserved->${bal.reserved}`,
        );
      }
    }

    const summary = await applyLotDedupe({ plan, lotModel, balanceModel, movementModel, dryRun });
    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, summary);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Dedupe FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
