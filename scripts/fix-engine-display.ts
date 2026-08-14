import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { extractEngineDisplay } from '../src/vehicle-shared/utils/vehicle-normalizer.util';

dotenvConfig();

/**
 * Corrige o campo engineDisplay (raiz) em vehicle_compatibilities, que ficou null na maioria dos
 * ~30159 documentos: o backfill anterior (backfill-vehicle-normalized-trim-traction.ts) nunca
 * populou esse campo (só trim/traction/cabType), e a migração de achatamento de schema só copiou
 * o valor (já ausente) de normalized.engineDisplay para a raiz, sem recalcular.
 *
 * Reprocessa TODOS os documentos (não só os com engineDisplay null) para garantir consistência —
 * recalcular é barato. Toca SOMENTE no campo engineDisplay.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[fix-engine-display] connected');

  const BATCH_SIZE = 500;
  let total = 0;
  let updated = 0;
  let lastId: any = null;

  // Pagina por _id (em vez de manter um cursor aberto por toda a execução) para evitar timeout de
  // cursor ocioso do MongoDB Atlas em bases grandes (~30k docs).
  while (true) {
    const pageFilter = lastId ? { _id: { $gt: lastId } } : {};
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
            engineDisplay: extractEngineDisplay(row.version) ?? null,
          },
        },
      },
    }));

    const result = await vehicleCompatibilities.bulkWrite(bulkOps);
    total += batch.length;
    updated += result.modifiedCount;
    lastId = batch[batch.length - 1]._id;
    console.log(`[fix-engine-display] progresso: total=${total}`);
  }

  console.log(`[fix-engine-display] total=${total} updated=${updated}`);

  await mongoose.disconnect();
  console.log('[fix-engine-display] done');
}

main().catch(async (err) => {
  console.error('[fix-engine-display] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
