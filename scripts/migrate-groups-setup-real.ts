// backend/scripts/migrate-groups-setup-real.ts
/**
 * Setup real dos 3 grupos/lojas (idempotente), com as contas ML e usuários
 * confirmados em produção em 2026-08-10. Substitui o backfill genérico de
 * migrate-groups-backfill.ts para este caso concreto (3 grupos, não 1).
 *
 * Grupos → conta ML (accountId real, marketplaces.accounts[]._id):
 *   Rocket Automotive → 6a22b272524aaa165d8c793c (label 'autopecas-default')
 *   Max Eshop         → 6a3287a54aa5dc3f80814768 (label 'MAXESHOP')
 *   RCK_AUTOMOTIVE    → 6a79ced04593b2c98ad9481c (label 'RCK_AUTOMOTIVE')
 *
 * Usuários → grupo:
 *   gustavo@rocketautomotive.com.br      → Max Eshop
 *   autopeca.genuina@gmail.com (Djalma)  → RCK_AUTOMOTIVE
 *   rosananogueira86@gmail.com (Rosana)  → Max Eshop
 *   teste.audit.balconista@example.com   → Max Eshop
 *
 * Usa MongoClient DIRETO (não sobe o AppModule), mesmo padrão de
 * migrate-accounts-into-marketplaces.ts. Idempotente: reexecutar é seguro.
 *
 * Requer no .env: MONGO_URI.
 * Run: npx ts-node scripts/migrate-groups-setup-real.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const GROUPS: Array<{ name: string; marketplaceTag: string; accountId: string }> = [
  { name: 'Rocket Automotive', marketplaceTag: 'mercadolivre', accountId: '6a22b272524aaa165d8c793c' },
  { name: 'Max Eshop', marketplaceTag: 'mercadolivre', accountId: '6a3287a54aa5dc3f80814768' },
  { name: 'RCK_AUTOMOTIVE', marketplaceTag: 'mercadolivre', accountId: '6a79ced04593b2c98ad9481c' },
];

const USER_GROUP_BY_EMAIL: Record<string, string> = {
  'gustavo@rocketautomotive.com.br': 'Max Eshop',
  'autopeca.genuina@gmail.com': 'RCK_AUTOMOTIVE',
  'rosananogueira86@gmail.com': 'Max Eshop',
  'teste.audit.balconista@example.com': 'Max Eshop',
};

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const groups = db.collection('groups');
    const users = db.collection('users');

    const idByName = new Map<string, string>();

    for (const g of GROUPS) {
      let doc = await groups.findOne({ name: g.name });
      if (!doc) {
        const res = await groups.insertOne({
          name: g.name,
          accounts: { [g.marketplaceTag]: g.accountId },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        idByName.set(g.name, String(res.insertedId));
        console.log(`  ✓ grupo criado: ${g.name} (${res.insertedId}) → ${g.marketplaceTag}=${g.accountId}`);
      } else {
        const accounts = { ...(doc.accounts || {}), [g.marketplaceTag]: g.accountId };
        await groups.updateOne({ _id: doc._id }, { $set: { accounts, updatedAt: new Date() } });
        idByName.set(g.name, String(doc._id));
        console.log(`  ✓ grupo atualizado: ${g.name} (${doc._id}) → ${g.marketplaceTag}=${g.accountId}`);
      }
    }

    let assigned = 0;
    for (const [email, groupName] of Object.entries(USER_GROUP_BY_EMAIL)) {
      const groupId = idByName.get(groupName);
      if (!groupId) throw new Error(`Grupo '${groupName}' não resolvido — não deveria acontecer.`);
      const res = await users.updateOne({ email }, { $set: { groupId } });
      if (res.matchedCount === 0) {
        console.warn(`  ! usuário não encontrado: ${email} (pulado)`);
        continue;
      }
      assigned++;
      console.log(`  ✓ ${email} → ${groupName} (${groupId})`);
    }

    console.log(`\nSetup done. groups=${GROUPS.length} usersAssigned=${assigned}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
