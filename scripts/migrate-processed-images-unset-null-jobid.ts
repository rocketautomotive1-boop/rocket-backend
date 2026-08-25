import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

/**
 * Remove o campo `jobId` de documentos de `processed_images` onde ele está
 * armazenado explicitamente como null. O schema costumava usar `default: null`,
 * então todo doc criado fora do fluxo de rembg (source:'ai', repositório) gravava
 * jobId:null em vez de omitir o campo — isso quebra a garantia de um índice
 * unique+sparse (que só ignora ausência, não null), causando E11000 dup key
 * { jobId: null } a partir do segundo doc sem jobId. Idempotente: rodar uma vez
 * por ambiente após o deploy do schema corrigido (jobId sem default).
 */

dotenvConfig();

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const collection = mongoose.connection.db.collection('processed_images');
  console.log('[processed-images-unset-null-jobid] connected');

  const res = await collection.updateMany({ jobId: null }, { $unset: { jobId: '' } });
  console.log(`[processed-images-unset-null-jobid] unset jobId on ${res.modifiedCount} docs`);

  await mongoose.disconnect();
  console.log('[processed-images-unset-null-jobid] done');
}

main().catch(async (err) => {
  console.error('[processed-images-unset-null-jobid] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
