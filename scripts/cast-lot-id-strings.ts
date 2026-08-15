// backend/scripts/cast-lot-id-strings.ts
/**
 * Corrige lotId gravado como STRING (em vez de ObjectId) em
 * store_listing_stock_balances/store_listing_stock_movements — artefato do
 * backfill de Fase 2 (backfill-store-listing-stock.ts), que gravava
 * `lotId: newLotId` direto de um `Map<string,string>` sem cast explícito (ver
 * fix em backfillBalances/backfillMovements).
 *
 * Isso é uma bomba-relógio silenciosa: qualquer StoreListingService.recordStockMovement
 * subsequente resolve o lote via findOneAndUpdate({storeListingId, lotId: ObjectId(...)})
 * — que nunca casa com um lotId salvo como string — e acaba criando um SEGUNDO balance
 * duplicado para o mesmo lote em vez de atualizar o existente (a mesma classe de bug
 * que produziu os 34 casos corrigidos por dedupe-store-listing-stock-lots.ts, mas
 * por um mecanismo diferente: tipo errado, não lote duplicado).
 *
 * Puramente um cast de tipo — não muda nenhum valor de negócio (onHand, reserved,
 * quantity), só a representação BSON do campo lotId.
 *
 * Uso:
 *   npx ts-node scripts/cast-lot-id-strings.ts             # dry-run
 *   npx ts-node scripts/cast-lot-id-strings.ts --execute    # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';

export interface LotIdCastRow {
  _id: Types.ObjectId;
  lotId?: Types.ObjectId | string;
}

export interface LotIdCastPlanEntry {
  docId: Types.ObjectId;
  castLotId: Types.ObjectId;
}

export function planLotIdStringCast(docs: LotIdCastRow[]): LotIdCastPlanEntry[] {
  const plan: LotIdCastPlanEntry[] = [];
  for (const doc of docs) {
    if (doc.lotId == null) continue;
    if (typeof doc.lotId !== 'string') continue;
    plan.push({ docId: doc._id, castLotId: new Types.ObjectId(doc.lotId) });
  }
  return plan;
}

export interface CastExecutionSummary {
  scanned: number;
  needingCast: number;
  cast: number;
}

export async function applyLotIdStringCast(params: {
  plan: LotIdCastPlanEntry[];
  model: Pick<Model<any>, 'updateOne'>;
  dryRun: boolean;
}): Promise<number> {
  const { plan, model, dryRun } = params;
  if (dryRun) return plan.length;

  for (const entry of plan) {
    await model.updateOne({ _id: entry.docId }, { $set: { lotId: entry.castLotId } });
  }
  return plan.length;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const {
    StoreListingStockBalanceModel,
  } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const {
    StoreListingStockMovementModel,
  } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name)) as Model<any>;
    const movementModel = app.get(getModelToken(StoreListingStockMovementModel.name)) as Model<any>;

    for (const [label, model] of [
      ['store_listing_stock_balances', balanceModel],
      ['store_listing_stock_movements', movementModel],
    ] as const) {
      const docs: LotIdCastRow[] = await model.find({}, { lotId: 1 }).lean().exec();
      const plan = planLotIdStringCast(docs);
      const summary: CastExecutionSummary = { scanned: docs.length, needingCast: plan.length, cast: 0 };
      summary.cast = await applyLotIdStringCast({ plan, model, dryRun });
      console.log(`${dryRun ? '[DRY-RUN] ' : ''}${label}:`, summary);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Cast FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
