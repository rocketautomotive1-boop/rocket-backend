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
  console.log(`[question-checkpoint-indexes] dropped index: ${match.name}`);
}

async function ensureIndexIdempotent(
  collection: Collection,
  key: Record<string, any>,
  options: Record<string, any>,
): Promise<void> {
  try {
    const name = await collection.createIndex(key, options);
    console.log(`[question-checkpoint-indexes] ensured index: ${name}`);
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('already exists with a different name')) {
      console.log(
        `[question-checkpoint-indexes] index already exists for key ${JSON.stringify(key)} (different name). Keeping existing index.`,
      );
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collection = db.collection('question_reconcile_checkpoints');

  console.log('[question-checkpoint-indexes] connected');

  // Legacy rows predate multi-client: stamp them as the default account so the
  // new compound unique index treats them as (marketplaceId, null).
  const backfill = await collection.updateMany(
    { accountId: { $exists: false } },
    { $set: { accountId: null } },
  );
  if ((backfill.modifiedCount ?? 0) > 0) {
    console.log(`[question-checkpoint-indexes] backfilled accountId:null on ${backfill.modifiedCount} legacy rows`);
  }

  // Drop the old single-field unique index that would E11000 a second account.
  await dropIndexIfExists(collection, { marketplaceId: 1 });

  await ensureIndexIdempotent(collection, { marketplaceId: 1, accountId: 1 }, {
    name: 'ux_question_checkpoint_marketplace_account',
    unique: true,
  });

  await mongoose.disconnect();
  console.log('[question-checkpoint-indexes] done');
}

main().catch(async (err) => {
  console.error('[question-checkpoint-indexes] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
