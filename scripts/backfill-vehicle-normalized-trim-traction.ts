import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { extractTraction, extractTrim } from '../src/vehicle-shared/utils/vehicle-normalizer.util';

dotenvConfig();

/**
 * Popula normalized.trim/normalized.traction nos registros existentes de vehicle_compatibilities
 * a partir de version (texto livre bruto do ML). Idempotente: só processa registros que ainda não
 * têm os campos novos.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[backfill-trim-traction] connected');

  const cursor = vehicleCompatibilities.find({
    $or: [
      { 'normalized.trim': { $exists: false } },
      { 'normalized.traction': { $exists: false } },
    ],
  });

  let total = 0;
  let updated = 0;

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    if (!row) continue;
    total++;

    const trim = extractTrim(row.version) ?? null;
    const traction = extractTraction(row.version) ?? null;

    await vehicleCompatibilities.updateOne(
      { _id: row._id },
      { $set: { 'normalized.trim': trim, 'normalized.traction': traction } },
    );
    updated++;
  }

  console.log(`[backfill-trim-traction] total=${total} updated=${updated}`);

  await mongoose.disconnect();
  console.log('[backfill-trim-traction] done');
}

main().catch(async (err) => {
  console.error('[backfill-trim-traction] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
