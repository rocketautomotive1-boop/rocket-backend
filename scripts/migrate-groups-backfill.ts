// backend/scripts/migrate-groups-backfill.ts
/**
 * Migração idempotente: cria o grupo padrão e preserva o comportamento de
 * publicação vigente antes da introdução do roteamento por grupo/loja.
 *
 * - Cria (ou reaproveita) um grupo `name` (default "Loja Padrão").
 * - Para cada marketplace com `activeAccountId` setado, mapeia
 *   `group.accounts[tag] = activeAccountId` — produtos do grupo padrão
 *   continuam publicando exatamente onde publicavam antes.
 * - Atribui `groupId` a todo UserModel que ainda não tem grupo.
 *
 * Produtos NÃO são tocados: o dono é resolvido em runtime via
 * product.createdByUserId → user.groupId (ver GroupService,
 * internal-product.controller.ts#getListings). Produtos cujo criador não
 * tem groupId (ou sem createdByUserId — import/discovery em massa) caem no
 * fallback já existente (activeAccountId do marketplace) sem quebrar nada.
 *
 * Usa MongoClient DIRETO (não sobe o AppModule), mesmo padrão de
 * migrate-accounts-into-marketplaces.ts.
 *
 * Requer no .env: MONGO_URI.
 * Run: npx ts-node scripts/migrate-groups-backfill.ts ["Nome do Grupo"]
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const groupName = process.argv[2] || 'Loja Padrão';

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const groups = db.collection('groups');
    const marketplaces = db.collection('marketplaces');
    const users = db.collection('users');

    let group = await groups.findOne({ name: groupName });
    if (!group) {
      const res = await groups.insertOne({ name: groupName, accounts: {}, createdAt: new Date(), updatedAt: new Date() });
      group = await groups.findOne({ _id: res.insertedId });
      console.log(`  ✓ grupo criado: ${groupName} (${res.insertedId})`);
    } else {
      console.log(`  ✓ grupo já existe: ${groupName} (${group._id})`);
    }

    const allMarketplaces = await marketplaces.find({}).toArray();
    const accounts: Record<string, string> = { ...(group.accounts || {}) };
    let mapped = 0;
    for (const mp of allMarketplaces) {
      if (!mp.activeAccountId || !mp.tag) continue;
      accounts[mp.tag] = String(mp.activeAccountId);
      mapped++;
    }
    await groups.updateOne({ _id: group._id }, { $set: { accounts, updatedAt: new Date() } });
    console.log(`  ✓ contas mapeadas: ${mapped} (${Object.keys(accounts).join(', ') || 'nenhuma'})`);

    const userRes = await users.updateMany(
      { $or: [{ groupId: { $exists: false } }, { groupId: null }] },
      { $set: { groupId: String(group._id) } },
    );
    console.log(`  ✓ usuários atribuídos ao grupo padrão: ${userRes.modifiedCount}`);

    console.log(`\nMigration done. group=${group._id} accountsMapped=${mapped} usersAssigned=${userRes.modifiedCount}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
