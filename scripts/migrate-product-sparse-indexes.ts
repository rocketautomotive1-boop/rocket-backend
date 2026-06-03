import { config as dotenvConfig } from 'dotenv';
import mongoose from 'mongoose';

/**
 * Torna os índices únicos de `products` SPARSE para `slug`, `partNumber` e
 * `barcode`. Necessário após a unificação: itens gerais (domain:'general') podem
 * não ter slug/partNumber, e múltiplos `null` violavam o índice unique não-sparse
 * (E11000 dup key { slug: null }). Idempotente: dropa o índice antigo (se existir)
 * e recria como unique+sparse. Rodar uma vez por ambiente.
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
  console.log(`[product-sparse-indexes] dropped index: ${match.name}`);
}

async function ensureUniqueSparse(collection: Collection, field: string): Promise<void> {
  await dropIndexIfExists(collection, { [field]: 1 });
  const name = await collection.createIndex({ [field]: 1 }, { unique: true, sparse: true });
  console.log(`[product-sparse-indexes] ensured unique+sparse index: ${name}`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI (or MONGO_URI) in environment');

  await mongoose.connect(uri);
  const collection = mongoose.connection.db.collection('products');
  console.log('[product-sparse-indexes] connected');

  // Sparse ignora apenas null/ausente — NÃO string vazia. Dados antigos com
  // "" violariam o índice unique+sparse. Normaliza "" → unset antes de indexar.
  for (const field of ['slug', 'partNumber', 'barcode']) {
    const res = await collection.updateMany({ [field]: '' }, { $unset: { [field]: '' } });
    if (res.modifiedCount) console.log(`[product-sparse-indexes] unset ${res.modifiedCount} empty "${field}"`);
  }

  // slug/partNumber: unique+sparse global (autopeças sempre geram; gerais podem não ter).
  for (const field of ['slug', 'partNumber']) {
    await ensureUniqueSparse(collection, field);
  }

  // barcode: NÃO é unique global — autopeças têm barcodes duplicados reais no
  // histórico. A unicidade só faz sentido para itens gerais (barcode = identidade).
  // Índice parcial: unique apenas onde domain:'general'.
  await dropIndexIfExists(collection, { barcode: 1 });
  const bcName = await collection.createIndex(
    { barcode: 1 },
    { unique: true, partialFilterExpression: { domain: 'general', barcode: { $type: 'string' } } },
  );
  console.log(`[product-sparse-indexes] ensured partial-unique barcode index (domain:general): ${bcName}`);

  await mongoose.disconnect();
  console.log('[product-sparse-indexes] done');
}

main().catch(async (err) => {
  console.error('[product-sparse-indexes] failed:', err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // no-op
  }
  process.exit(1);
});
