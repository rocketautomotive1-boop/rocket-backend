/**
 * One-time, idempotent backfill: migrates the legacy stock_movements into the new model
 * (lots + materialized balances). Safe to re-run.
 *
 * Standalone (no Nest DI) — connects directly to MONGO_URI and works on the raw collections.
 * Run (AFTER taking a DB snapshot):
 *   npx ts-node -r tsconfig-paths/register src/stock/migration/backfill-stock.ts
 *
 * Steps:
 *  0. Ensure collections exist.
 *  1. Rewrite legacy type aliases on movements (sale→outbound, purchase_return→inbound).
 *  2. Create one stock_lot per (productId, condition), seeding unitCost from legacy cost
 *     (latest inbound costPrice/price; else product.costPrice); attach lotId to movements.
 *  3. Materialize stock_balances per (lotId, box) from the ledger using MOVEMENT_EFFECT.
 */
import * as dotenv from 'dotenv';
import { MongoClient, ObjectId, Decimal128 } from 'mongodb';
import { MOVEMENT_EFFECT, StockMovementType, LEGACY_TYPE_ALIASES } from '../../stock-shared/movement-type';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const movements = db.collection('stock_movements');
  const lots = db.collection('stock_lots');
  const balances = db.collection('stock_balances');
  const products = db.collection('products');

  // 0. Ensure collections exist + unique index on balances (lotId, boxId).
  for (const name of ['stock_lots', 'stock_balances']) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) await db.createCollection(name);
  }
  await balances.createIndex({ lotId: 1, boxId: 1 }, { unique: true });
  await lots.createIndex({ productId: 1, condition: 1 });

  // 1. Rewrite legacy type aliases.
  for (const [legacy, canonical] of Object.entries(LEGACY_TYPE_ALIASES)) {
    const r = await movements.updateMany({ type: legacy }, { $set: { type: canonical } });
    console.log(`[backfill] alias ${legacy}->${canonical}: ${r.modifiedCount}`);
  }

  // 2. Create one lot per (productId, condition) for movements without a lotId; attach lotId.
  const groups = await movements
    .aggregate([
      { $match: { lotId: { $exists: false } } },
      {
        $group: {
          _id: { productId: '$productId', condition: { $ifNull: ['$condition', 'new'] } },
          lastInboundCost: {
            $top: { sortBy: { date: -1 }, output: { $ifNull: ['$costPrice', '$price'] } },
          },
        },
      },
    ])
    .toArray();

  let lotsCreated = 0;
  for (const g of groups) {
    const productId: ObjectId = g._id.productId;
    const condition: string = g._id.condition || 'new';

    // Seed cost: latest inbound legacy cost; fall back to product.costPrice.
    let cost = g.lastInboundCost != null ? Number(g.lastInboundCost.toString()) : 0;
    if (!(cost > 0)) {
      const p = await products.findOne({ _id: productId }, { projection: { costPrice: 1 } });
      const legacy = (p as any)?.costPrice != null ? Number((p as any).costPrice.toString()) : 0;
      if (legacy > 0) cost = legacy;
    }

    let lot = await lots.findOne({ productId, condition });
    if (!lot) {
      const insert = await lots.insertOne({
        productId,
        condition,
        unitCost: Decimal128.fromString(String(Number.isFinite(cost) ? cost : 0)),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      lot = { _id: insert.insertedId } as any;
      lotsCreated++;
    }

    await movements.updateMany(
      { productId, condition: condition === 'new' ? { $in: ['new', null] } : condition, lotId: { $exists: false } },
      { $set: { lotId: lot!._id } },
    );
  }
  console.log(`[backfill] lots created: ${lotsCreated} (groups: ${groups.length})`);

  // 3. Materialize balances per (lotId, box) from the ledger using MOVEMENT_EFFECT.
  const onHandBranches = Object.values(StockMovementType).map((t) => ({
    case: { $eq: ['$type', t] },
    then: { $multiply: ['$quantity', MOVEMENT_EFFECT[t].onHand] },
  }));
  const reservedBranches = Object.values(StockMovementType).map((t) => ({
    case: { $eq: ['$type', t] },
    then: { $multiply: ['$quantity', MOVEMENT_EFFECT[t].reserved] },
  }));

  const truth = await movements
    .aggregate([
      { $match: { lotId: { $exists: true } } },
      { $addFields: { box: { $ifNull: ['$toBoxId', '$fromBoxId'] } } },
      {
        $group: {
          _id: { lotId: '$lotId', boxId: '$box' },
          onHand: { $sum: { $switch: { branches: onHandBranches, default: 0 } } },
          reserved: { $sum: { $switch: { branches: reservedBranches, default: 0 } } },
          productId: { $first: '$productId' },
          condition: { $first: { $ifNull: ['$condition', 'new'] } },
        },
      },
    ])
    .toArray();

  let upserts = 0;
  for (const t of truth) {
    await balances.updateOne(
      { lotId: t._id.lotId, boxId: t._id.boxId ?? null },
      {
        $set: { onHand: t.onHand, reserved: t.reserved, updatedAt: new Date() },
        $setOnInsert: { productId: t.productId, condition: t.condition, createdAt: new Date() },
      },
      { upsert: true },
    );
    upserts++;
  }
  console.log(`[backfill] balances materialized: ${upserts} (lot,box) rows`);

  await client.close();
  console.log('[backfill] done.');
}

run().catch((e) => {
  console.error('[backfill] FAILED:', e);
  process.exit(1);
});
