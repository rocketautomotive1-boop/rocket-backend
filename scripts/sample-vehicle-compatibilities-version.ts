import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

dotenvConfig();

/**
 * READ-ONLY: amostra vehicle_compatibilities para entender o formato real do campo `version`
 * (string livre) e desenhar uma migração de schema. Não faz nenhum insert/update/delete.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const col = db.collection('vehicle_compatibilities');

  console.log('[sample-version] connected');

  const totalCount = await col.estimatedDocumentCount();
  console.log(`[sample-version] estimated total documents: ${totalCount}`);

  // 1) Amostra aleatória
  const sample = await col
    .aggregate([{ $sample: { size: 80 } }])
    .toArray();

  console.log(`\n===== SAMPLE (${sample.length} docs) =====`);
  for (const doc of sample) {
    console.log(
      JSON.stringify({
        make: doc.make,
        model: doc.model,
        version: doc.version,
        displacement: doc.engine?.displacement,
        fuelType: doc.engine?.fuelType,
        doors: doc.dimensions?.doors,
        transmission: doc.transmission,
      }),
    );
  }

  // 2) Contagem aproximada de valores distintos + top 30
  console.log('\n===== TOP 30 version VALUES BY COUNT =====');
  const topVersions = await col
    .aggregate([
      { $match: { version: { $exists: true, $ne: null } } },
      { $group: { _id: '$version', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ])
    .toArray();
  for (const row of topVersions) {
    console.log(`${row.count}\t${row._id}`);
  }

  const distinctApprox = await col
    .aggregate([
      { $match: { version: { $exists: true, $ne: null } } },
      { $group: { _id: '$version' } },
      { $count: 'distinctCount' },
    ])
    .toArray();
  console.log(`\n[sample-version] approx distinct version values: ${distinctApprox[0]?.distinctCount ?? 0}`);

  // 3) Detecção de padrões via regex no campo version
  console.log('\n===== PATTERN DETECTION (regex over version field) =====');
  const patterns: Record<string, RegExp> = {
    doors_mention: /\d\s*p\b/i,
    flex: /\bflex\b/i,
    gasolina: /\bgasolina\b|\bgas\b/i,
    diesel: /\bdiesel\b/i,
    etanol_alcool: /\betanol\b|\balcool\b|\bálcool\b/i,
    gnv: /\bgnv\b/i,
    turbo: /\bturbo\b/i,
    aut_automatico: /\baut\b|\baut[oó]matic[oa]?\b/i,
    manual: /\bmanual\b|\bmec[aâ]nic[oa]?\b/i,
    cvt: /\bcvt\b/i,
    tract_4x4: /\b4x4\b/i,
    tract_4x2: /\b4x2\b/i,
    awd: /\bawd\b/i,
    locker: /\blocker\b/i,
    displacement_in_text: /\b\d[.,]\d\b/,
  };

  const totalWithVersion = await col.countDocuments({ version: { $exists: true, $nin: [null, ''] } });
  console.log(`[sample-version] total docs with non-empty version: ${totalWithVersion}`);

  for (const [name, regex] of Object.entries(patterns)) {
    const count = await col.countDocuments({ version: { $regex: regex } });
    const pct = totalWithVersion > 0 ? ((count / totalWithVersion) * 100).toFixed(1) : '0.0';
    console.log(`${name}\t${count}\t(${pct}%)`);
  }

  await mongoose.disconnect();
  console.log('\n[sample-version] done');
}

main().catch(async (err) => {
  console.error('[sample-version] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
