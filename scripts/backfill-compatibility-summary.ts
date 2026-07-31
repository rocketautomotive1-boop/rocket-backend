import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

dotenvConfig();

/**
 * Recalcula ProductModel.compatibilitySummary a partir de product_compatibilities.product
 * (ObjectId), para todo produto que tem linhas de compatibilidade cadastradas.
 *
 * Corrige o efeito do bug em recomputeCompatibilitySummary (product-compatibility.service.ts),
 * que buscava por `productId` (string, nunca gravado nas inserções atuais) em vez de `product`
 * (ObjectId, sempre gravado), zerando compatibilitySummary silenciosamente para produtos cujas
 * compatibilidades foram criadas/recriadas depois da introdução do bug. Idempotente.
 */
async function main(): Promise<void> {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI (or MONGODB_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const compatCollection = db.collection('product_compatibilities');
  const vehicleCollection = db.collection('vehicle_compatibilities');
  const productCollection = db.collection('products');

  console.log('[backfill-compat-summary] connected');

  const productIds: string[] = await compatCollection.distinct('product');
  console.log(`[backfill-compat-summary] produtos com compatibilidades: ${productIds.length}`);

  let updated = 0;
  let skipped = 0;

  for (const rawProductId of productIds) {
    if (!rawProductId || !mongoose.Types.ObjectId.isValid(rawProductId)) {
      skipped++;
      continue;
    }
    const productObjectId = new mongoose.Types.ObjectId(rawProductId);

    const rows = await compatCollection
      .find({ product: productObjectId })
      .project({ vehicleId: 1 })
      .toArray();

    const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter((id) => id && mongoose.Types.ObjectId.isValid(id)))];
    const vehicles = vehicleIds.length
      ? await vehicleCollection
          .find({ _id: { $in: vehicleIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .project({ make: 1, model: 1 })
          .toArray()
      : [];

    const makes = [...new Set(vehicles.map((v) => v.make).filter(Boolean))];
    const models = [...new Set(vehicles.map((v) => v.model).filter(Boolean))];

    const summary = {
      makes,
      models,
      vehicleCount: rows.length,
      updatedAt: new Date(),
    };

    const result = await productCollection.updateOne(
      { _id: productObjectId },
      { $set: { compatibilitySummary: summary } },
    );

    if (result.matchedCount > 0) {
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`[backfill-compat-summary] produtos atualizados: ${updated}`);
  console.log(`[backfill-compat-summary] produtos não encontrados (órfãos): ${skipped}`);

  await mongoose.disconnect();
  console.log('[backfill-compat-summary] done');
}

main().catch(async (err) => {
  console.error('[backfill-compat-summary] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
