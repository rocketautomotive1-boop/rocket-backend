/**
 * One-off, idempotent: remove legacy price fields from products + listings AFTER the pricing
 * backfill has run and was validated. Standalone (no Nest DI). Run AFTER a snapshot:
 *   npx ts-node -r tsconfig-paths/register src/pricing/migration/unset-legacy-product-price.ts
 *
 * Removes: products.price, products.listPrice, products.pricing; listings.price.
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

  const rp = await db.collection('products').updateMany({}, { $unset: { price: '', listPrice: '', pricing: '' } });
  console.log(`[unset-pricing] products modified: ${rp.modifiedCount}`);

  const rl = await db.collection('listings').updateMany({}, { $unset: { price: '' } });
  console.log(`[unset-pricing] listings modified: ${rl.modifiedCount}`);

  await client.close();
  console.log('[unset-pricing] done.');
}

run().catch((e) => {
  console.error('[unset-pricing] FAILED:', e);
  process.exit(1);
});
