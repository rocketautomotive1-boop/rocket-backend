import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

/**
 * `products.category` deve ser um ObjectId ref para `categories` (schema atual,
 * `product.schema.ts`). 398 produtos (levantamento em 2026-07-14) ainda guardam o
 * shape legado (objeto embutido `{ id, name, parentId, externalId, _id }` de antes
 * da normalização para ref) — o `_id` embutido não existe mais em `categories`
 * (árvore foi reconstruída), então o populate falha silenciosamente e a API
 * devolve `category: null` pro produto, mesmo ele tendo categoria de verdade.
 *
 * Resolve a categoria atual por `marketplaceMappings.externalId` (o código ML,
 * ex. "MLB47119", estável através de reconstruções da árvore) — não pelo `_id`
 * embutido (morto) nem por nome (colide: várias categorias podem ter o mesmo nome
 * em ramos diferentes da árvore).
 *
 * Idempotente: só afeta docs onde `category` ainda é objeto embutido (`category.name`
 * existe). Rodar com --dry-run primeiro pra conferir a contagem antes de aplicar.
 */

dotenvConfig();

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const products = db.collection('products');
  const categories = db.collection('categories');
  console.log(`[category-embedded-to-ref] connected${DRY_RUN ? ' (dry-run)' : ''}`);

  const legacy = await products
    .find({ 'category.name': { $exists: true } })
    .project({ category: 1 })
    .toArray();
  console.log(`[category-embedded-to-ref] found ${legacy.length} products with embedded category`);

  const externalIds = [...new Set(legacy.map((d) => d.category?.externalId).filter(Boolean))];
  const matchingCategories = await categories
    .find({ 'marketplaceMappings.externalId': { $in: externalIds } })
    .project({ _id: 1, marketplaceMappings: 1 })
    .toArray();

  const externalIdToCategoryId = new Map<string, mongoose.Types.ObjectId>();
  for (const cat of matchingCategories) {
    for (const mapping of cat.marketplaceMappings || []) {
      if (externalIds.includes(mapping.externalId) && !externalIdToCategoryId.has(mapping.externalId)) {
        externalIdToCategoryId.set(mapping.externalId, cat._id);
      }
    }
  }

  let resolved = 0;
  let unresolved = 0;
  for (const doc of legacy) {
    const extId = doc.category?.externalId;
    const categoryId = extId ? externalIdToCategoryId.get(extId) : undefined;

    if (!categoryId) {
      unresolved++;
      console.log(
        `[category-embedded-to-ref] unresolved: product ${doc._id} — externalId "${extId}" not found in categories, clearing to null`,
      );
      if (!DRY_RUN) {
        await products.updateOne({ _id: doc._id }, { $set: { category: null } });
      }
      continue;
    }

    resolved++;
    if (!DRY_RUN) {
      await products.updateOne({ _id: doc._id }, { $set: { category: categoryId } });
    }
  }

  console.log(`[category-embedded-to-ref] resolved: ${resolved}, unresolved: ${unresolved}`);
  if (DRY_RUN) console.log('[category-embedded-to-ref] dry-run — no writes performed');

  await mongoose.disconnect();
  console.log('[category-embedded-to-ref] done');
}

main().catch(async (err) => {
  console.error('[category-embedded-to-ref] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
