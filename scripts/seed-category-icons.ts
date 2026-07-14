// backend/scripts/seed-category-icons.ts
/**
 * Atribui o campo `icon` (nome de ícone lucide-react, resolvido no rocket-b2c via
 * resolveCategoryIcon) às categorias de topo e seus filhos diretos. Idempotente
 * (match por nome exato). Categorias sem regra caem no fallback `Zap` do frontend.
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-category-icons.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const ICON_BY_NAME: Record<string, string> = {
  'Acessórios': 'ShieldCheck',
  'Acessórios para Veículos': 'CircleDot',
  'Alimentos': 'Droplet',
  'Alimentos e Bebidas': 'Droplet',
  'Beleza': 'Waves',
  'Beleza e Cuidado Pessoal': 'Waves',
  'Casa e Limpeza': 'Wrench',
  'Ferramentas': 'Wrench',
  'Saúde': 'ShieldCheck',

  'Diagnóstico e Escaneamento': 'MonitorSmartphone',
  'Elevação e Suporte': 'Waves',
  'Ferramentas de Inspeção Veicular': 'Wrench',
  'Ferramentas para Baterias': 'BatteryFull',
  'Guinchos e Equipamentos de Reboque': 'Disc3',
  'Medição': 'Wrench',
  'Para Baterias': 'BatteryFull',
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const collection = db.collection('categories');

    let updated = 0;
    for (const [name, icon] of Object.entries(ICON_BY_NAME)) {
      const result = await collection.updateMany({ name }, { $set: { icon } });
      updated += result.modifiedCount;
    }

    console.log(`[seed-category-icons] atualizadas ${updated} categorias`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[seed-category-icons] failed:', err?.message || err);
  process.exit(1);
});
