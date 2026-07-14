import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

dotenvConfig();

/**
 * Achata o schema de vehicle_compatibilities: move campos de dentro de normalized/engine/
 * dimensions para a raiz do documento (makeKey/modelKey/versionKey, engineDisplay,
 * displacementCc, fuelType, fuelTags, doors, trim, traction, cabType), encolhe engine/dimensions
 * para só o que não tem campo próprio (powerHp e o resto de dimensions), e remove os campos
 * mortos productionYears/chassis/fuel (raiz, distinto de engine.fuelType).
 *
 * NÃO recalcula canonicalKey — copia o valor existente sem tocar, preservando a dedupe do
 * importador ML (ver docs/superpowers/specs/2026-07-14-vehicle-compatibility-schema-flatten-design.md).
 *
 * Idempotente: só processa documentos que ainda têm o campo `normalized` (schema antigo).
 * Reexecutável sem efeito colateral.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[migrate-flatten-schema] connected');

  const filter = { normalized: { $exists: true } };

  const BATCH_SIZE = 500;
  let total = 0;
  let updated = 0;
  let lastId: any = null;

  while (true) {
    const pageFilter = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
    const batch = await vehicleCompatibilities
      .find(pageFilter)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) break;

    const bulkOps = batch.map((row) => {
      const normalized = row.normalized ?? {};
      const engine = row.engine ?? {};
      const dimensions = row.dimensions ?? {};

      return {
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              makeKey: normalized.make,
              modelKey: normalized.model,
              versionKey: normalized.version,
              engineDisplay: normalized.engineDisplay ?? null,
              displacementCc: normalized.displacementCc ?? null,
              fuelType: engine.fuelType ?? null,
              fuelTags: normalized.fuelTags ?? [],
              trim: normalized.trim ?? null,
              traction: normalized.traction ?? null,
              cabType: normalized.cabType ?? null,
              doors: dimensions.doors ?? null,
              engine: engine.powerHp !== undefined && engine.powerHp !== null ? { powerHp: engine.powerHp } : null,
              dimensions: {
                fuelCapacityL: dimensions.fuelCapacityL ?? null,
                heightMm: dimensions.heightMm ?? null,
                lengthMm: dimensions.lengthMm ?? null,
                passengerCapacity: dimensions.passengerCapacity ?? null,
                wheelbaseMm: dimensions.wheelbaseMm ?? null,
                widthMm: dimensions.widthMm ?? null,
              },
            },
            $unset: {
              normalized: '',
              productionYears: '',
              chassis: '',
              fuel: '',
            },
          },
        },
      };
    });

    const result = await vehicleCompatibilities.bulkWrite(bulkOps);
    total += batch.length;
    updated += result.modifiedCount + result.matchedCount;
    lastId = batch[batch.length - 1]._id;
    console.log(`[migrate-flatten-schema] progresso: total=${total}`);
  }

  console.log(`[migrate-flatten-schema] total=${total} updated=${updated}`);

  await mongoose.disconnect();
  console.log('[migrate-flatten-schema] done');
}

main().catch(async (err) => {
  console.error('[migrate-flatten-schema] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
