import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { extractCabType, extractTraction, extractTrim } from '../src/vehicle-shared/utils/vehicle-normalizer.util';

dotenvConfig();

/**
 * Popula normalized.trim/normalized.traction/normalized.cabType nos registros de
 * vehicle_compatibilities a partir de version (texto livre bruto do ML).
 *
 * Por padrão só processa registros que ainda não têm normalized.cabType (idempotente pra rodadas
 * futuras). Passe --force para reprocessar TODOS os registros e sobrescrever trim/traction/cabType
 * — necessário depois de mudar a lógica de extração (ex: nova sigla, novo padrão reconhecido).
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  const force = process.argv.includes('--force');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log(`[backfill-trim-traction] connected (force=${force})`);

  const filter = force ? {} : { 'normalized.cabType': { $exists: false } };

  const BATCH_SIZE = 500;
  let total = 0;
  let updated = 0;
  let lastId: any = null;

  // Pagina por _id (em vez de manter um cursor aberto por toda a execução) para evitar timeout de
  // cursor ocioso do MongoDB Atlas em bases grandes (~30k docs). Necessário em modo --force porque
  // o filtro não encolhe a cada lote processado (todos os docs continuam batendo no filtro vazio).
  while (true) {
    const pageFilter = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await vehicleCompatibilities
      .find(pageFilter)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;

    const bulkOps = batch.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            'normalized.trim': extractTrim(row.version) ?? null,
            'normalized.traction': extractTraction(row.version) ?? null,
            'normalized.cabType': extractCabType(row.version) ?? null,
          },
        },
      },
    }));

    const result = await vehicleCompatibilities.bulkWrite(bulkOps);
    total += batch.length;
    updated += result.modifiedCount + result.matchedCount;
    lastId = batch[batch.length - 1]._id;
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
