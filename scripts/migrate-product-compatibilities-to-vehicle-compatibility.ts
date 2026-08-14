import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { normalizeMake, normalizeModel, normalizeVersionDisplay } from '../src/vehicle-shared/utils/vehicle-normalizer.util';

dotenvConfig();

/**
 * Casa cada linha antiga de product_compatibilities (texto solto de marca/modelo/ano/versão do
 * ML) com o registro correspondente já importado em vehicle_compatibilities, e grava o _id
 * encontrado em vehicleId + o antigo vehicleId (numérico do ML) em mlVehicleId.
 *
 * Casos sem match ficam sinalizados (needsReview: true) para revisão manual — não bloqueiam
 * nada, o produto continua sincronizado com o ML normalmente enquanto isso.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const productCompatibilities = db.collection('product_compatibilities');
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[migrate-compat] connected');

  // Reprocessa tanto linhas nunca migradas quanto as marcadas needsReview (sem match numa
  // rodada anterior) — a base de veículos cresce a cada importação, então um "sem match" de
  // ontem pode bater hoje. Idempotente: já casados (needsReview:false) não são reprocessados.
  const cursor = productCompatibilities.find({
    $or: [{ mlVehicleId: { $exists: false } }, { needsReview: true }],
  });

  let matched = 0;
  let unmatched = 0;
  let total = 0;

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    if (!row) continue;
    total++;

    const make = normalizeMake(row.vehicleBrand ?? '');
    const model = normalizeModel(row.vehicleModel ?? '');
    const version = normalizeVersionDisplay(row.vehicleVersion ?? row.vehicleModel ?? '');

    const match = await vehicleCompatibilities.findOne({
      'normalized.make': make,
      'normalized.model': model,
      'normalized.version': version,
    });

    if (match) {
      await productCompatibilities.updateOne(
        { _id: row._id },
        {
          $set: {
            mlVehicleId: row.vehicleId,
            vehicleId: String(match._id),
            needsReview: false,
          },
        },
      );
      matched++;
    } else {
      await productCompatibilities.updateOne(
        { _id: row._id },
        {
          $set: {
            mlVehicleId: row.vehicleId,
            needsReview: true,
          },
        },
      );
      unmatched++;
    }
  }

  console.log(`[migrate-compat] total=${total} matched=${matched} unmatched=${unmatched}`);

  await mongoose.disconnect();
  console.log('[migrate-compat] done');
}

main().catch(async (err) => {
  console.error('[migrate-compat] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
