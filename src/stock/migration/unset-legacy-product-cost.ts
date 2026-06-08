/**
 * One-off, idempotent: remove the legacy cost/stock fields from products AFTER the backfill
 * has seeded lot cost + materialized balances and the result was validated.
 *
 * Standalone (no Nest DI). Run AFTER backfill + validation + a fresh DB snapshot:
 *   npx ts-node -r tsconfig-paths/register src/stock/migration/unset-legacy-product-cost.ts
 *
 * Removes: products.costPrice, products.stockReserved.
 * (price, listPrice, pricing, lastPurchase are kept — catalog / fiscal audit.)
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const products = db.collection('products');

  const before = await products.countDocuments({
    $or: [{ costPrice: { $exists: true } }, { stockReserved: { $exists: true } }],
  });
  console.log(`[unset] products carrying legacy cost/stock fields: ${before}`);

  const r = await products.updateMany({}, { $unset: { costPrice: '', stockReserved: '' } });
  console.log(`[unset] products modified: ${r.modifiedCount}`);

  const after = await products.countDocuments({
    $or: [{ costPrice: { $exists: true } }, { stockReserved: { $exists: true } }],
  });
  console.log(`[unset] remaining with legacy fields (should be 0): ${after}`);

  await client.close();
  console.log('[unset] done.');
}

run().catch((e) => {
  console.error('[unset] FAILED:', e);
  process.exit(1);
});
