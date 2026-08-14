import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

dotenvConfig();

type BackfillCandidate = {
  productId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
};

async function loadCandidates(db: mongoose.mongo.Db): Promise<BackfillCandidate[]> {
  return db.collection('user_productivity')
    .aggregate<BackfillCandidate>([
      {
        $match: {
          type: 'CREATE',
          productId: { $type: 'objectId' },
          userId: { $type: 'objectId' },
        },
      },
      { $sort: { createdAt: 1, 'data.timestamp': 1 } },
      {
        $group: {
          _id: '$productId',
          userId: { $first: '$userId' },
        },
      },
      {
        $project: {
          _id: 0,
          productId: '$_id',
          userId: 1,
        },
      },
    ])
    .toArray();
}

async function applyBackfill(db: mongoose.mongo.Db, candidates: BackfillCandidate[]): Promise<number> {
  if (!candidates.length) return 0;

  const operations = candidates.map((candidate) => ({
    updateOne: {
      filter: {
        _id: candidate.productId,
        createdByUserId: { $exists: false },
      },
      update: {
        $set: { createdByUserId: candidate.userId },
      },
    },
  }));

  const result = await db.collection('products').bulkWrite(operations, { ordered: false });
  return result.modifiedCount ?? 0;
}

async function ensureProductCreatorIndex(db: mongoose.mongo.Db): Promise<void> {
  await db.collection('products').createIndex(
    { createdByUserId: 1, active: 1 },
    { name: 'idx_products_createdByUserId_active' },
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  await ensureProductCreatorIndex(db);
  const candidates = await loadCandidates(db);
  const modified = await applyBackfill(db, candidates);

  console.log(`[product-creator-backfill] candidates=${candidates.length} modified=${modified}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[product-creator-backfill] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
