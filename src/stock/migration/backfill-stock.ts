/**
 * One-time, idempotent backfill: migrates the legacy stock_movements into the new model
 * (lots + materialized balances). Safe to re-run.
 *
 * Run (AFTER taking a DB snapshot):
 *   npx ts-node -r tsconfig-paths/register src/stock/migration/backfill-stock.ts
 *
 * Steps:
 *  0. Ensure collections exist (Mongo can't create them inside a transaction).
 *  1. Rewrite legacy type aliases on movements (sale→outbound, purchase_return→inbound).
 *  2. Create one StockLot per (productId, condition) and attach lotId to legacy movements.
 *  3. Materialize StockBalance from the ledger via the reconciler (recompute, idempotent).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { StockRepository } from '../stock.repository';
import { StockReconcilerService } from '../stock-reconciler.service';
import { LEGACY_TYPE_ALIASES } from '../domain/movement-type';
import { Types } from 'mongoose';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error', 'log'] });
  const repo = app.get(StockRepository);
  const reconciler = app.get(StockReconcilerService);

  // 0. Ensure collections exist (no-op if already there).
  for (const m of [repo.lotModel, repo.balanceModel, repo.movementModel]) {
    try { await m.createCollection(); } catch { /* already exists */ }
  }
  await repo.movementModel.syncIndexes();
  await repo.balanceModel.syncIndexes();
  await repo.lotModel.syncIndexes();

  // 1. Rewrite legacy type aliases.
  for (const [legacy, canonical] of Object.entries(LEGACY_TYPE_ALIASES)) {
    const r = await repo.movementModel.updateMany({ type: legacy }, { $set: { type: canonical } });
    console.log(`[backfill] alias ${legacy}->${canonical}: ${r.modifiedCount}`);
  }

  // 2. Create one lot per (productId, condition) for movements without a lotId; attach lotId.
  //    Seed the lot's unitCost from legacy cost: prefer the latest inbound's costPrice/price
  //    for that (product, condition); fall back to 0. Legacy stored cost in costPrice OR price.
  const groups = await repo.movementModel.aggregate([
    { $match: { lotId: { $exists: false } } },
    {
      $group: {
        _id: { productId: '$productId', condition: { $ifNull: ['$condition', 'new'] } },
        // latest inbound cost: take the cost of the most recent inbound movement
        lastInboundCost: {
          $top: {
            sortBy: { date: -1 },
            output: { $ifNull: ['$costPrice', '$price'] },
          },
        },
      },
    },
  ]);
  for (const g of groups) {
    const legacyCost = g.lastInboundCost != null ? Number(g.lastInboundCost.toString()) : 0;
    const lot = await repo.findOrCreateLot(
      g._id.productId,
      g._id.condition,
      Types.Decimal128.fromString(String(Number.isFinite(legacyCost) ? legacyCost : 0)),
    );
    await repo.movementModel.updateMany(
      { productId: g._id.productId, condition: g._id.condition, lotId: { $exists: false } },
      { $set: { lotId: lot._id } },
    );
  }
  console.log(`[backfill] lots created/attached for ${groups.length} (product,condition) groups`);

  // 3. Materialize balances from the ledger.
  const res = await reconciler.reconcileAll();
  console.log(`[backfill] balances materialized: checked=${res.checked} fixed=${res.fixed}`);

  await app.close();
  console.log('[backfill] done.');
}

run().catch((e) => {
  console.error('[backfill] FAILED:', e);
  process.exit(1);
});
