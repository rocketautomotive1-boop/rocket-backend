/**
 * Regenera `slug` de TODOS os produtos com a fórmula nova: nome legível
 * (displayName com fallback pra name) + marca (brand.shortName, quando houver)
 * + identificador estável (partNumber ou barcode). Isso alinha a URL pública
 * (`/product/{slug}`) ao nome do produto e à marca (ex:
 * "disco-de-embreagem-fras-le-cad2936"), em vez de expor só código de peça.
 *
 * Idempotente por design: recalcula o slug de cada produto do zero a cada
 * rodada; produtos cujo slug já bate com o resultado da fórmula são pulados.
 *
 * Segurança:
 *   - DRY-RUN por padrão: mostra quantos mudariam + amostras (antes → depois), SEM gravar.
 *   - Só grava com a flag --apply.
 *
 * Uso (a partir de backend/):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-product-slug.ts            # dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-product-slug.ts --apply    # grava
 */
import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';
import { buildUniqueProductSlug } from '../src/product/utils/product-slug.util';

dotenvConfig();

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const collection = mongoose.connection.db.collection('products');
  console.log('[backfill-product-slug] connected');

  const cursor = collection.find(
    { active: { $ne: false } },
    { projection: { _id: 1, slug: 1, displayName: 1, name: 1, partNumber: 1, barcode: 1, brand: 1 } },
  );

  let scanned = 0;
  let changed = 0;
  let skipped = 0;
  const samples: string[] = [];

  // Slugs já atribuídos NESTA rodada contam como "existentes" pra evitar colisão
  // entre dois produtos que mudariam pro mesmo slug na mesma passada.
  const assignedThisRun = new Set<string>();

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) break;
    scanned++;

    const nextSlug = await buildUniqueProductSlug(
      {
        displayName: doc.displayName,
        name: doc.name,
        brandShortName: doc.brand?.shortName,
        partNumber: doc.partNumber,
        barcode: doc.barcode,
      },
      async (candidate) => {
        if (assignedThisRun.has(candidate)) return true;
        const existing = await collection.findOne({ slug: candidate, _id: { $ne: doc._id } });
        return !!existing;
      },
    );
    assignedThisRun.add(nextSlug);

    if (nextSlug === doc.slug) {
      skipped++;
      continue;
    }

    changed++;
    if (samples.length < 15) {
      samples.push(`    ${doc._id}: "${doc.slug ?? '(vazio)'}" → "${nextSlug}"`);
    }

    if (APPLY) {
      await collection.updateOne({ _id: doc._id }, { $set: { slug: nextSlug } });
    }
  }

  console.log('═══════════════════════════ RESULTADO ═══════════════════════════');
  console.log(`Produtos analisados:  ${scanned}`);
  console.log(`Slugs alterados:      ${changed}`);
  console.log(`Slugs mantidos:       ${skipped}`);
  if (samples.length) {
    console.log('Exemplos (antes → depois):');
    samples.forEach((s) => console.log(s));
  }
  if (APPLY) {
    console.log(`✅ slug gravado em ${changed} produto(s).`);
  } else {
    console.log(`🧪 DRY-RUN: nada foi escrito. Rode com --apply para gravar ${changed} alteração(ões).`);
  }
  console.log('──────────────────────────────────────────────────────────────────');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[backfill-product-slug] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
