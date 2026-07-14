import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { toLowerClean } from '../src/vehicle-shared/utils/string.util';

dotenvConfig();

/**
 * Backfill idempotente de searchText (por vínculo, product_compatibilities) e
 * compatibilitySummary (denormalizado no Product), preenchendo os dois campos na mesma
 * passada agrupada por productId. Ver docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md,
 * "Migração de dados".
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const productCompatibilities = db.collection('product_compatibilities');
  const products = db.collection('products');
  const vehicleCompatibilities = db.collection('vehicle_compatibilities');

  console.log('[backfill-search] connected');

  const productIds = await productCompatibilities.distinct('productId');
  console.log(`[backfill-search] ${productIds.length} produtos com compatibilidades`);

  let productsProcessed = 0;
  let rowsUpdated = 0;

  for (const productId of productIds) {
    if (!productId) continue;

    const product = mongoose.Types.ObjectId.isValid(productId)
      ? await products.findOne({ _id: new mongoose.Types.ObjectId(productId) }, { projection: { name: 1, oemCodes: 1, attributes: 1 } })
      : null;

    const equivalentOemCodes = (product?.attributes ?? [])
      .filter((a: any) => a.code === 'EQUIVALENT_OEM')
      .map((a: any) => a.valueName ?? a.value)
      .filter(Boolean);

    const rows = await productCompatibilities.find({ productId }).toArray();

    const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter(Boolean))]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const vehicles = await vehicleCompatibilities.find({ _id: { $in: vehicleIds } }).toArray();
    const vehiclesById = new Map(vehicles.map((v) => [String(v._id), v]));

    const makes = new Set<string>();
    const models = new Set<string>();

    for (const row of rows) {
      const vehicle = vehiclesById.get(String(row.vehicleId));
      if (vehicle?.make) makes.add(vehicle.make);
      if (vehicle?.model) models.add(vehicle.model);

      const tokens = [
        product?.name,
        ...(product?.oemCodes ?? []),
        ...equivalentOemCodes,
        vehicle?.make,
        vehicle?.model,
        vehicle?.versionDisplay ?? vehicle?.version,
        ...(vehicle?.years ?? []),
        ...(vehicle?.aliases ?? []),
      ]
        .map((s) => toLowerClean(String(s ?? '')))
        .filter(Boolean);

      const searchText = [...new Set(tokens)].join(' ');

      await productCompatibilities.updateOne({ _id: row._id }, { $set: { searchText } });
      rowsUpdated++;
    }

    if (mongoose.Types.ObjectId.isValid(productId)) {
      await products.updateOne(
        { _id: new mongoose.Types.ObjectId(productId) },
        {
          $set: {
            compatibilitySummary: {
              makes: [...makes],
              models: [...models],
              vehicleCount: rows.length,
              updatedAt: new Date(),
            },
          },
        },
      );
    }

    productsProcessed++;
  }

  console.log(`[backfill-search] produtos=${productsProcessed} vínculos=${rowsUpdated}`);

  await mongoose.disconnect();
  console.log('[backfill-search] done');
}

main().catch(async (err) => {
  console.error('[backfill-search] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
