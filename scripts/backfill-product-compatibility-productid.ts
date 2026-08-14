import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

dotenvConfig();

/**
 * Migração de campo: dados legados de product_compatibilities gravam a referência ao produto
 * em `product` (string), deixando `productId` (o campo que o código atual usa para buscas
 * reversas/resumo) vazio. Preenche `productId = product` em todo registro onde `productId` está
 * ausente e `product` existe. Idempotente — roda em qualquer momento sem duplicar/corromper dado.
 *
 * Depois de rodar este script, desfazer os fallbacks $or/$ifNull marcados com
 * "TODO(desfazer após migração)" em product-compatibility.service.ts e
 * product-vehicle-search.service.ts, voltando a usar só `productId`.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collection = db.collection('product_compatibilities');

  console.log('[backfill-productid] connected');

  const filter = {
    $and: [
      { $or: [{ productId: { $exists: false } }, { productId: null }] },
      { product: { $exists: true, $ne: null } },
    ],
  };

  const toMigrate = await collection.countDocuments(filter);
  console.log(`[backfill-productid] registros a migrar: ${toMigrate}`);

  const cursor = collection.find(filter);
  let migrated = 0;

  while (await cursor.hasNext()) {
    const row = await cursor.next();
    if (!row) continue;

    await collection.updateOne(
      { _id: row._id },
      { $set: { productId: String(row.product) } },
    );
    migrated++;
  }

  console.log(`[backfill-productid] migrados: ${migrated}`);

  await mongoose.disconnect();
  console.log('[backfill-productid] done');
}

main().catch(async (err) => {
  console.error('[backfill-productid] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
