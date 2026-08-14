import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

/**
 * Dropa e recria como sparse os índices únicos de original*Id nas 3 coleções
 * de estoque da Fase 3 (store_listing_stock_lots/balances/movements). O
 * backfill da Fase 2 populou essas coleções com original*Id em TODOS os
 * documentos migrados, então os índices foram criados unique NÃO-sparse
 * (autoIndex nunca viu um documento sem o campo). A Fase 2 mudou o schema
 * pra original*Id opcional+sparse (documentos NOVOS, criados via dual-write,
 * nunca têm esse campo — não são migrados, são originados aqui). autoIndex
 * do Mongoose CRIA índices novos declarados no schema mas nunca ALTERA um
 * índice existente — sem este script, o índice antigo (não-sparse) continua
 * vivo em produção, e o segundo documento sem original*Id (segundo
 * movimento de estoque real após o deploy) colide (Mongo trata ausência
 * como null; dois nulls colidem em índice único não-sparse). Rodar uma vez
 * por ambiente, antes de subir o código do Phase 3 dual-write. Idempotente:
 * recriar um índice sparse que já é sparse é no-op efetivo (dropa e recria
 * igual).
 */

type Collection = any;

dotenvConfig();

const TARGETS: Array<{ collection: string; field: string }> = [
  { collection: 'store_listing_stock_lots', field: 'originalLotId' },
  { collection: 'store_listing_stock_balances', field: 'originalBalanceId' },
  { collection: 'store_listing_stock_movements', field: 'originalMovementId' },
];

async function migrateOne(collection: Collection, field: string): Promise<void> {
  const indexes = await collection.indexes();
  const match = indexes.find((idx: any) => {
    const keys = Object.keys(idx.key);
    return keys.length === 1 && keys[0] === field;
  });

  if (match && match.unique && match.sparse) {
    console.log(`[store-listing-stock-sparse-indexes] ${collection.collectionName}.${field}: já sparse, no-op`);
    return;
  }

  if (match) {
    await collection.dropIndex(match.name);
    console.log(`[store-listing-stock-sparse-indexes] dropped non-sparse index: ${match.name}`);
  }

  await collection.createIndex({ [field]: 1 }, { unique: true, sparse: true });
  console.log(`[store-listing-stock-sparse-indexes] created sparse unique index on ${collection.collectionName}.${field}`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  console.log('[store-listing-stock-sparse-indexes] connected');

  for (const { collection, field } of TARGETS) {
    const coll = mongoose.connection.db.collection(collection);
    await migrateOne(coll, field);
  }

  console.log('[store-listing-stock-sparse-indexes] done');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[store-listing-stock-sparse-indexes] FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
