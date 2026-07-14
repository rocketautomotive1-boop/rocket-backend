// backend/scripts/seed-search-synonyms.ts
/**
 * Seed inicial da collection search_synonyms consumida pelo índice Atlas Search
 * product_compatibility_search (product/atlas-search-index.json). Formato explícito do Atlas
 * Search synonym mapping — ver docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md,
 * Seções 5, 7 e 10. Idempotente (upsert por `name`).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-search-synonyms.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

interface SynonymGroup {
  name: string;
  synonyms: string[];
}

const SYNONYM_GROUPS: SynonymGroup[] = [
  // Sinônimos de categoria de produto (nomenclatura regional)
  { name: 'palheta_limpador', synonyms: ['palheta', 'limpador de para-brisa', 'limpador de parabrisa', 'wiper'] },
  { name: 'cambota_virabrequim', synonyms: ['cambota', 'virabrequim'] },
  { name: 'matraca_catraca', synonyms: ['matraca', 'catraca'] },

  // Abreviações de posição/lado (Seção 10) — não é erro de digitação, é forma abreviada válida
  { name: 'posicao_esquerdo', synonyms: ['esq', 'esquerdo', 'esquerda'] },
  { name: 'posicao_direito', synonyms: ['dir', 'direito', 'direita'] },
  { name: 'posicao_dianteiro', synonyms: ['diant', 'dianteiro', 'dianteira', 'frente'] },
  { name: 'posicao_traseiro', synonyms: ['tras', 'traseiro', 'traseira'] },
];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const collection = db.collection('search_synonyms');

    let upserted = 0;
    for (const group of SYNONYM_GROUPS) {
      await collection.updateOne(
        { name: group.name },
        { $set: { mappingType: 'equivalent', synonyms: group.synonyms } },
        { upsert: true },
      );
      upserted++;
    }

    console.log(`[seed-search-synonyms] upserted ${upserted} grupos de sinônimos`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[seed-search-synonyms] failed:', err?.message || err);
  process.exit(1);
});
