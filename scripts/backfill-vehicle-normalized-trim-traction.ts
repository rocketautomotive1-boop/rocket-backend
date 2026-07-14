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

  const filter = {
    $or: [
      { 'normalized.trim': { $exists: false } },
      { 'normalized.traction': { $exists: false } },
    ],
  };

  const BATCH_SIZE = 500;
  let total = 0;
  let updated = 0;

  // Relê o filtro a cada lote (em vez de manter um cursor aberto por toda a execução) para
  // evitar timeout de cursor ocioso do MongoDB Atlas em bases grandes (~30k docs).
  while (true) {
    const batch = await vehicleCompatibilities.find(filter).limit(BATCH_SIZE).toArray();
    if (batch.length === 0) break;

    const bulkOps = batch.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            'normalized.trim': extractTrim(row.version) ?? null,
            'normalized.traction': extractTraction(row.version) ?? null,
          },
        },
      },
    }));

    const result = await vehicleCompatibilities.bulkWrite(bulkOps);
    total += batch.length;
    updated += result.modifiedCount + result.matchedCount;
    console.log(`[backfill-trim-traction] progresso: total=${total}`);
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
