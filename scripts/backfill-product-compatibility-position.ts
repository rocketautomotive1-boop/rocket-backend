// backend/scripts/backfill-product-compatibility-position.ts
/**
 * Backfill idempotente: resolve mlCatalogProductId/position/sidePosition para
 * linhas de product_compatibilities já sincronizadas com o Mercado Livre, via
 * catalog matching de PEÇA (/products/search por marca+part_number, distinto do
 * catálogo de veículos MLB-CARS_AND_VANS). Ver
 * docs/superpowers/specs/2026-07-15-ml-position-import-catalog-listing-design.md.
 *
 * Não bloqueia nada: sem match exato único → positionNeedsReview=true e segue.
 * Domínios sem POSITION/SIDE_POSITION cadastrados → grava mlCatalogProductId sem
 * posição (não é erro).
 *
 * Idempotente: só toca linhas sem mlCatalogProductId E sem positionNeedsReview.
 * Usa MongoClient direto (sem subir o AppModule). Requer MONGO_URI no .env.
 * Run:        npx ts-node scripts/backfill-product-compatibility-position.ts
 * Dry-run:    npx ts-node scripts/backfill-product-compatibility-position.ts --dry
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { resolvePositionMatch, MlCatalogSearchResult } from '../src/product/utils/ml-position-match.util';

const ML_API = 'https://api.mercadolibre.com';
const ML_TAG = 'mercadolivre';
const THROTTLE_MS = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchCatalogProducts(
  accessToken: string,
  brand: string,
  partNumber: string,
  categoryId: string,
): Promise<MlCatalogSearchResult[]> {
  const url = new URL(`${ML_API}/products/search`);
  url.searchParams.set('site_id', 'MLB');
  url.searchParams.set('q', `${brand} ${partNumber}`);
  url.searchParams.set('category', categoryId);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  const body: any = await res.json().catch(() => null);
  return Array.isArray(body?.results) ? body.results : [];
}

async function getCatalogProduct(
  accessToken: string,
  catalogProductId: string,
): Promise<MlCatalogSearchResult | null> {
  const res = await fetch(`${ML_API}/products/${catalogProductId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function main() {
  const dry = process.argv.includes('--dry');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();

    const mp = await db.collection('marketplaces').findOne({ tag: ML_TAG });
    if (!mp) throw new Error(`marketplace tag=${ML_TAG} não encontrado`);
    const mlMarketplaceId = String(mp._id);

    const account = (mp.accounts ?? []).find((a: any) => a?.token?.accessToken);
    if (!account) throw new Error('Nenhuma conta ML com accessToken — não dá para resolver posição.');
    const accessToken: string = account.token.accessToken;
    console.log(`Usando conta ML: ${account.label}`);

    const compatibilities = db.collection('product_compatibilities');
    const products = db.collection('products');
    const categories = db.collection('categories');

    const pending = await compatibilities
      .find({
        syncedWithMarketplace: true,
        mlCatalogProductId: { $exists: false },
        positionNeedsReview: { $ne: true },
      })
      .project({ _id: 1, productId: 1, product: 1 })
      .toArray();

    console.log(`Linhas pendentes de resolução de posição: ${pending.length}${dry ? ' (DRY-RUN)' : ''}\n`);

    let resolved = 0, needsReview = 0, skippedNoData = 0;

    for (const row of pending) {
      const productIdRaw = row.productId ?? row.product;
      if (!productIdRaw || !ObjectId.isValid(String(productIdRaw))) {
        skippedNoData++;
        continue;
      }

      const product = await products.findOne(
        { _id: new ObjectId(String(productIdRaw)) },
        { projection: { partNumber: 1, brand: 1, category: 1 } },
      );
      const partNumber = product?.partNumber;
      const brandName = product?.brand?.name;

      if (!partNumber || !brandName) {
        skippedNoData++;
        if (!dry) {
          await compatibilities.updateOne({ _id: row._id }, { $set: { positionNeedsReview: true } });
        }
        continue;
      }

      let categoryId: string | null = null;
      if (product.category && ObjectId.isValid(String(product.category))) {
        const category = await categories.findOne({ _id: new ObjectId(String(product.category)) });
        const mapping = (category?.marketplaceMappings ?? []).find(
          (m: any) => String(m.marketplaceId) === mlMarketplaceId,
        );
        categoryId = mapping?.externalId ? String(mapping.externalId) : null;
      }

      if (!categoryId) {
        needsReview++;
        if (!dry) {
          await compatibilities.updateOne({ _id: row._id }, { $set: { positionNeedsReview: true } });
        }
        await sleep(THROTTLE_MS);
        continue;
      }

      const results = await searchCatalogProducts(accessToken, brandName, partNumber, categoryId);
      const match = resolvePositionMatch(results, partNumber);

      if (!match.catalogProductId) {
        needsReview++;
        console.log(`  ? ${row._id}: sem match exato (part_number=${partNumber}) — needsReview`);
        if (!dry) {
          await compatibilities.updateOne({ _id: row._id }, { $set: { positionNeedsReview: true } });
        }
        await sleep(THROTTLE_MS);
        continue;
      }

      const fullProduct = await getCatalogProduct(accessToken, match.catalogProductId);
      const finalMatch = fullProduct ? resolvePositionMatch([fullProduct], partNumber) : match;

      if (!dry) {
        await compatibilities.updateOne(
          { _id: row._id },
          {
            $set: {
              mlCatalogProductId: finalMatch.catalogProductId ?? match.catalogProductId,
              position: finalMatch.position,
              positionName: finalMatch.positionName,
              sidePosition: finalMatch.sidePosition,
              sidePositionName: finalMatch.sidePositionName,
              positionNeedsReview: false,
            },
          },
        );
      }
      resolved++;
      console.log(`  ✓ ${row._id}: catalog_product_id=${match.catalogProductId} position=${finalMatch.positionName ?? '(sem POSITION neste domínio)'}`);

      await sleep(THROTTLE_MS);
    }

    console.log(
      `\nDone. total=${pending.length} resolvidos=${resolved} needsReview=${needsReview} semDadosSuficientes=${skippedNoData}${dry ? ' (nada gravado)' : ''}.`,
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill product_compatibilities position FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
