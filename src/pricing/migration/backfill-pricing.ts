/**
 * One-time, idempotent backfill: legacy product.price/listPrice/pricing → product_pricing.
 * Standalone (no Nest DI), like the stock migrations. Run AFTER a DB snapshot:
 *   npx ts-node -r tsconfig-paths/register src/pricing/migration/backfill-pricing.ts
 *
 * overrides[] start empty (no legacy per-marketplace price data — Listing.price was dormant).
 */
import * as dotenv from 'dotenv';
import { MongoClient, Decimal128 } from 'mongodb';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const products = db.collection('products');
  const pricing = db.collection('product_pricing');

  const exists = await db.listCollections({ name: 'product_pricing' }).hasNext();
  if (!exists) await db.createCollection('product_pricing');
  await pricing.createIndex({ productId: 1 }, { unique: true });

  const cursor = products.find({}, { projection: { price: 1, listPrice: 1, pricing: 1 } });
  let n = 0;
  for await (const p of cursor) {
    const base = (p as any).price != null ? Number((p as any).price.toString()) : 0;
    const lp = (p as any).listPrice != null ? Number((p as any).listPrice.toString()) : undefined;
    const pr = (p as any).pricing;
    const meta = pr ? { markup: pr.markup, profitMargin: pr.profitMargin, strategy: pr.strategy } : undefined;

    await pricing.updateOne(
      { productId: p._id },
      {
        $setOnInsert: { productId: p._id, overrides: [], createdAt: new Date() },
        $set: {
          basePrice: Decimal128.fromString(String(Number.isFinite(base) ? base : 0)),
          ...(lp !== undefined ? { listPrice: Decimal128.fromString(String(lp)) } : {}),
          ...(meta ? { meta } : {}),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    n++;
  }
  console.log(`[backfill-pricing] product_pricing docs upserted: ${n}`);
  await client.close();
  console.log('[backfill-pricing] done.');
}

run().catch((e) => {
  console.error('[backfill-pricing] FAILED:', e);
  process.exit(1);
});
