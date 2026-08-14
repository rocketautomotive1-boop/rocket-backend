import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { normalizeDisplacementCc, normalizeFuelTags } from '../src/vehicle-shared/utils/vehicle-normalizer.util';

dotenvConfig();

/**
 * Popula normalized.displacementCc/normalized.fuelTags nos registros existentes de
 * vehicle_compatibilities a partir de engine.displacement/engine.fuelType (formato bruto do ML).
 * Idempotente: só processa registros que ainda não têm os campos novos.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[backfill-engine-fields] connected');

  const cursor = vehicleCompatibilities.find({
    $or: [
      { 'normalized.displacementCc': { $exists: false } },
      { 'normalized.fuelTags': { $exists: false } },
    ],
  });

  let total = 0;
  let updated = 0;

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    if (!row) continue;
    total++;

    const displacementCc = normalizeDisplacementCc(row.engine?.displacement) ?? null;
    const fuelTags = normalizeFuelTags(row.engine?.fuelType);

    await vehicleCompatibilities.updateOne(
      { _id: row._id },
      { $set: { 'normalized.displacementCc': displacementCc, 'normalized.fuelTags': fuelTags } },
    );
    updated++;
  }

  console.log(`[backfill-engine-fields] total=${total} updated=${updated}`);

  await mongoose.disconnect();
  console.log('[backfill-engine-fields] done');
}

main().catch(async (err) => {
  console.error('[backfill-engine-fields] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
