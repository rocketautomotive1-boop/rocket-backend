import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

type Collection = any;

dotenvConfig();

function sameKey(a: Record<string, any>, b: Record<string, any>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, idx) => k === bKeys[idx] && a[k] === b[k]);
}

async function dropIndexIfExists(
  collection: Collection,
  key: Record<string, any>,
): Promise<void> {
  const indexes = await collection.indexes();
  const match = indexes.find((idx) => sameKey(idx.key as Record<string, any>, key));
  if (!match) return;
  if (match.name === '_id_') return;
  await collection.dropIndex(match.name);
  console.log(`[discovery-indexes] dropped index: ${match.name}`);
}

async function ensureSingleActiveIntentPerProduct(collection: Collection): Promise<void> {
  const activeByProduct = await collection
    .aggregate([
      { $match: { productId: { $exists: true, $ne: null }, isActiveIntent: true } },
      { $sort: { intentVersion: -1, updatedAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$productId',
          keepId: { $first: '$_id' },
          allIds: { $push: '$_id' },
        },
      },
      {
        $project: {
          staleIds: {
            $filter: {
              input: '$allIds',
              as: 'id',
              cond: { $ne: ['$$id', '$keepId'] },
            },
          },
        },
      },
      { $match: { 'staleIds.0': { $exists: true } } },
    ])
    .toArray();

  let fixed = 0;
  for (const row of activeByProduct) {
    const staleIds = row.staleIds as any[];
    if (!staleIds.length) continue;
    const res = await collection.updateMany(
      { _id: { $in: staleIds } },
      { $set: { isActiveIntent: false, supersededAt: new Date() } },
    );
    fixed += res.modifiedCount ?? 0;
  }
  if (fixed > 0) {
    console.log(`[discovery-indexes] fixed stale active intents: ${fixed}`);
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collection = db.collection('product_discoveries');

  console.log('[discovery-indexes] connected');

  await ensureSingleActiveIntentPerProduct(collection);

  await dropIndexIfExists(collection, { partNumberNorm: 1, brandNorm: 1, isGenuine: 1 });
  await dropIndexIfExists(collection, { productId: 1, isActiveIntent: 1 });
  await dropIndexIfExists(collection, { partNumberNorm: 1, brandNorm: 1, isGenuine: 1, productId: 1 });

  await ensureIndexIdempotent(collection, { partNumberNorm: 1, brandNorm: 1, isGenuine: 1, productId: 1 }, {
    name: 'ux_discovery_pending_scope',
    unique: true,
    partialFilterExpression: { status: 'pending' },
  });
  await ensureIndexIdempotent(collection, { productId: 1, isActiveIntent: 1 }, {
    name: 'ux_discovery_active_intent_product',
    unique: true,
    partialFilterExpression: { isActiveIntent: true, productId: { $exists: true } },
  });

  await mongoose.disconnect();
  console.log('[discovery-indexes] done');
}

async function ensureIndexIdempotent(
  collection: Collection,
  key: Record<string, any>,
  options: Record<string, any>,
): Promise<void> {
  try {
    const name = await collection.createIndex(key, options);
    console.log(`[discovery-indexes] ensured index: ${name}`);
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('already exists with a different name')) {
      console.log(`[discovery-indexes] index already exists for key ${JSON.stringify(key)} (different name). Keeping existing index.`);
      return;
    }
    throw err;
  }
}

main().catch(async (err) => {
  console.error('[discovery-indexes] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
