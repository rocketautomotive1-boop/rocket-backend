// backend/scripts/migrate-user-groupid-to-storeid.ts
/**
 * Migra UserModel.groupId (ObjectId de 'groups', formato antigo) para
 * UserModel.storeId (ObjectId de 'stores', formato atual lido pelo
 * código desde o commit 7b2cdb2), resolvendo pelo NOME da loja —
 * 'groups' e 'stores' têm _ids diferentes mesmo após
 * migrate-groups-to-stores.ts (stores foi criada com novos _ids, não
 * copiou os antigos).
 *
 * Depende de migrate-groups-to-stores.ts já ter rodado (precisa que
 * 'stores' esteja populada). Idempotente: usuários que já têm storeId e
 * não têm mais groupId são ignorados na próxima execução.
 *
 * Usa MongoClient DIRETO (não sobe o AppModule), mesmo padrão de
 * migrate-groups-setup-real.ts.
 *
 * Requer no .env: MONGO_URI.
 * Run: npx ts-node scripts/migrate-user-groupid-to-storeid.ts
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const groups = db.collection('groups');
    const stores = db.collection('stores');
    const users = db.collection('users');

    const groupNameById = new Map<string, string>();
    for (const g of await groups.find().toArray()) {
      groupNameById.set(String(g._id), g.name);
    }

    const storeIdByName = new Map<string, string>();
    for (const s of await stores.find().toArray()) {
      storeIdByName.set(s.name, String(s._id));
    }

    let migrated = 0;
    let skipped = 0;

    const usersWithGroupId = await users.find({ groupId: { $exists: true } }).toArray();
    for (const u of usersWithGroupId) {
      const groupName = groupNameById.get(String(u.groupId));
      if (!groupName) {
        console.warn(`  SKIP ${u.email}: groupId ${u.groupId} não resolvido em groups`);
        skipped++;
        continue;
      }
      const newStoreId = storeIdByName.get(groupName);
      if (!newStoreId) {
        console.warn(`  SKIP ${u.email}: loja '${groupName}' não encontrada em stores`);
        skipped++;
        continue;
      }
      await users.updateOne(
        { _id: u._id },
        { $set: { storeId: newStoreId }, $unset: { groupId: '' } },
      );
      migrated++;
      console.log(`  ✓ migrated: ${u.email} → storeId=${newStoreId} (${groupName})`);
    }

    console.log(`\nMigração concluída. migrated=${migrated} skipped=${skipped}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
