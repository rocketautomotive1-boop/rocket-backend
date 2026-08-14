/**
 * One-time, idempotent migration: product_pricing.listPrice (campo solto, sem vigência) →
 * product_pricing.promotion { listPrice, startsAt, endsAt }. Ver
 * docs/superpowers/specs/2026-07-13-offers-system-design.md.
 *
 * Janela de vigência de 30 dias a partir de agora — rede de segurança para não sumir descontos
 * já visíveis em produção sem aviso; a equipe deve revisar/reconfigurar antes do prazo.
 *
 * Standalone (no Nest DI), como as demais migrações de pricing. Run AFTER a DB snapshot:
 *   npx ts-node -r tsconfig-paths/register src/pricing/migration/migrate-listprice-to-promotion.ts
 */
import * as dotenv from 'dotenv';
import { MongoClient, Decimal128 } from 'mongodb';

dotenv.config();

const PROMOTION_WINDOW_DAYS = 30;

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const pricing = db.collection('product_pricing');

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + PROMOTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const cursor = pricing.find(
    { listPrice: { $exists: true, $ne: null }, promotion: { $exists: false } },
    { projection: { _id: 1, listPrice: 1 } },
  );

  let n = 0;
  for await (const doc of cursor) {
    const listPrice = (doc as any).listPrice as Decimal128;
    await pricing.updateOne(
      { _id: doc._id },
      {
        $set: { promotion: { listPrice, startsAt, endsAt } },
        $unset: { listPrice: '' },
      },
    );
    n++;
  }

  console.log(`[migrate-listprice-to-promotion] product_pricing docs migrados: ${n}`);
  await client.close();
  console.log('[migrate-listprice-to-promotion] done.');
}

run().catch((e) => {
  console.error('[migrate-listprice-to-promotion] FAILED:', e);
  process.exit(1);
});
