import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { toLowerClean } from '../src/vehicle-shared/utils/string.util';

dotenvConfig();

/**
 * Backfill idempotente de searchText (por vínculo, product_compatibilities) e
 * compatibilitySummary (denormalizado no Product), preenchendo os dois campos na mesma
 * passada agrupada por product (ObjectId, fonte de verdade — ver
 * docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md, "Migração de dados").
 *
 * Reescrito porque a versão anterior agrupava/consultava por `productId` (campo string
 * removido do schema — órfão desde que a escrita passou a preencher só `product`).
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

  const productObjectIds: mongoose.Types.ObjectId[] = await productCompatibilities.distinct('product');
  console.log(`[backfill-search] ${productObjectIds.length} produtos com compatibilidades`);

  let productsProcessed = 0;
  let rowsUpdated = 0;

  for (const productObjectId of productObjectIds) {
    if (!productObjectId) continue;

    const product = await products.findOne(
      { _id: productObjectId },
      { projection: { name: 1, displayName: 1, partNumber: 1, oemCodes: 1, attributes: 1 } },
    );

    const productName = product?.displayName ?? product?.name;

    const equivalentOemCodes = (product?.attributes ?? [])
      .filter((a: any) => a.code === 'EQUIVALENT_OEM')
      .map((a: any) => a.valueName ?? a.value)
      .filter(Boolean);

    const rows = await productCompatibilities.find({ product: productObjectId }).toArray();

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
        productName,
        product?.partNumber,
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

    await products.updateOne(
      { _id: productObjectId },
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
