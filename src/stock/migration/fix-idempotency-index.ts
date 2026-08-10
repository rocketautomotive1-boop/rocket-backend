/**
 * One-time fix: the `stock_movements` idempotency index was declared `sparse: true`, but a
 * `sparse` flag on a COMPOUND index only excludes a document if ALL indexed fields are absent.
 * Since `productId`/`type` are always present, every movement without `metadata.externalReference`
 * (i.e. every `adjust()`-produced correction/reversal — the append-only edit/delete path) was
 * indexed with `metadata.externalReference: null`, so the SECOND such movement per (productId, type)
 * throws E11000 duplicate key. Dropping and recreating as a partial index (which correctly excludes
 * documents missing the field, regardless of other indexed fields) fixes it.
 *
 * Safe to re-run. Run (AFTER taking a DB snapshot):
 *   npx ts-node -r tsconfig-paths/register src/stock/migration/fix-idempotency-index.ts
 */
import * as dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const INDEX_NAME = 'metadata.externalReference_1_productId_1_type_1';

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const movements = db.collection('stock_movements');

  const existing = await movements.indexes();
  const bad = existing.find((idx) => idx.name === INDEX_NAME);
  if (bad) {
    await movements.dropIndex(INDEX_NAME);
    console.log(`[fix-idempotency-index] dropped old index (sparse=${bad.sparse ?? false})`);
  } else {
    console.log('[fix-idempotency-index] old index not found, skipping drop');
  }

  await movements.createIndex(
    { 'metadata.externalReference': 1, productId: 1, type: 1 },
    { unique: true, partialFilterExpression: { 'metadata.externalReference': { $exists: true } }, name: INDEX_NAME },
  );
  console.log('[fix-idempotency-index] recreated as a partial index — done.');

  await client.close();
}

run().catch((e) => {
  console.error('[fix-idempotency-index] FAILED:', e);
  process.exit(1);
});
