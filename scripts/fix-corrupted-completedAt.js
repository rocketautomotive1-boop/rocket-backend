/**
 * One-off cleanup: products whose `completion.completedAt` is stored as a
 * non-date value (notably `{}`) cause:
 *   Cast to date failed for value "{}" (type Object) at path "completedAt"
 * on every readiness refresh, because the old `?? null` guard let truthy
 * objects through.
 *
 * This script finds those documents and resets the field to `null` so the
 * (now-fixed) service can write a real Date going forward.
 *
 * Usage (from backend/):
 *   node scripts/fix-corrupted-completedAt.js          # dry run (report only)
 *   node scripts/fix-corrupted-completedAt.js --apply  # actually fix
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('MONGO_URI not set in environment/.env');
  process.exit(1);
}

// dbName is taken from the connection string (rocket_db).
(async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(); // db from URI
    const col = db.collection('products');

    // Match docs where completedAt exists but is NOT a Date and NOT null.
    // BSON type 9 = Date, type 10 = null. Anything else (object=3, etc.) is corrupt.
    const filter = {
      'completion.completedAt': { $exists: true },
      $expr: {
        $and: [
          { $ne: [{ $type: '$completion.completedAt' }, 'date'] },
          { $ne: [{ $type: '$completion.completedAt' }, 'null'] },
        ],
      },
    };

    const corrupted = await col
      .find(filter)
      .project({ _id: 1, 'completion.completedAt': 1, 'completion.readyToPublish': 1 })
      .toArray();

    console.log(`Found ${corrupted.length} product(s) with corrupted completion.completedAt`);
    for (const doc of corrupted) {
      console.log(
        `  ${doc._id.toString()}  value=${JSON.stringify(doc.completion?.completedAt)}  readyToPublish=${doc.completion?.readyToPublish}`,
      );
    }

    if (corrupted.length === 0) {
      console.log('Nothing to fix.');
      return;
    }

    if (!APPLY) {
      console.log('\nDry run. Re-run with --apply to set these to null.');
      return;
    }

    const res = await col.updateMany(filter, { $set: { 'completion.completedAt': null } });
    console.log(`\nFixed ${res.modifiedCount} document(s).`);
  } finally {
    await client.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
