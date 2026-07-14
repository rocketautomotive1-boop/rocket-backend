// backend/scripts/backfill-category-active-field.ts
/**
 * Backfill de `active` para categorias antigas gravadas antes do schema default
 * existir. Sem o campo, `.find({active:true})` (usado por getTree/es-tree/autocomplete)
 * as exclui, quebrando a árvore: filhos "órfãos" viram falsos roots (buildTree só
 * aninha quem acha o parentId no set filtrado). Idempotente (só afeta docs sem o campo).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/backfill-category-active-field.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const collection = db.collection('categories');

    const before = await collection.countDocuments({ active: { $exists: false } });
    const result = await collection.updateMany(
      { active: { $exists: false } },
      { $set: { active: true } },
    );

    console.log(`[backfill-category-active-field] docs sem 'active' antes: ${before}, atualizados: ${result.modifiedCount}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[backfill-category-active-field] failed:', err?.message || err);
  process.exit(1);
});
