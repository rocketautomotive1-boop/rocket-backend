import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

/**
 * Dropa os índices únicos ANTIGOS de `listings` e `marketplace_listings` que
 * assumiam no máximo 1 listing por (produto/StoreListing, marketplace) — falso
 * neste negócio, que gera N títulos por veículo compatível (limite de 60
 * caracteres do ML). O código já declara os índices novos (com externalId na
 * chave, parcial), mas `autoIndex` do Mongoose CRIA índices novos e nunca
 * DROPA os antigos — sem este script, o índice antigo continua vivo em
 * produção e o backfill volta a falhar com o mesmo E11000 de antes. Rodar
 * uma vez por ambiente, antes de retomar backfill-store-listings.ts
 * --execute. Idempotente: se o índice antigo já não existir, é no-op.
 */

type Collection = any;

dotenvConfig();

function sameKey(a: Record<string, any>, b: Record<string, any>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, idx) => k === bKeys[idx] && a[k] === b[k]);
}

async function dropIndexIfExists(collection: Collection, key: Record<string, any>): Promise<void> {
  const indexes = await collection.indexes();
  const match = indexes.find((idx: any) => sameKey(idx.key as Record<string, any>, key));
  if (!match || match.name === '_id_') return;
  await collection.dropIndex(match.name);
  console.log(`[store-listing-indexes] dropped index: ${match.name}`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  console.log('[store-listing-indexes] connected');

  const listings = mongoose.connection.db.collection('listings');
  const marketplaceListings = mongoose.connection.db.collection('marketplace_listings');

  // Antigo: unique em (productId, marketplaceId, storeId), sem externalId —
  // colide quando um produto tem N listings reais no mesmo marketplace+loja.
  await dropIndexIfExists(listings, { productId: 1, marketplaceId: 1, storeId: 1 });

  // Antigo: unique em (storeListingId, marketplaceTag), sem externalId —
  // mesmo problema, na collection nova.
  await dropIndexIfExists(marketplaceListings, { storeListingId: 1, marketplaceTag: 1 });

  console.log('[store-listing-indexes] done — Mongoose autoIndex recria os índices novos (com externalId) no próximo boot da app.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[store-listing-indexes] FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
