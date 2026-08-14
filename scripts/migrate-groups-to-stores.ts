// backend/scripts/migrate-groups-to-stores.ts
/**
 * Copia a collection 'groups' (formato antigo, escrita por
 * migrate-groups-setup-real.ts) para 'stores' (formato atual, lido por
 * StoreModel/StoreService desde o commit 7b2cdb2), reformatando
 * accounts: Record<tag, accountId> para marketplaceAccounts:
 * Array<{marketplaceTag, accountId}>.
 *
 * Motivo: o rename de código groups→stores (7b2cdb2) não migrou os dados.
 * Produção ficou com 'groups' populado (3 lojas reais) e 'stores' vazia,
 * quebrando silenciosamente a resolução de conta-dona em
 * internal-product.controller.ts → worker de sync ML (ver memória
 * ml-403-owner-account-routing). Idempotente: reexecutar não duplica
 * (upsert por name) nem sobrescreve marketplaceAccounts com dado mais
 * antigo se stores já tiver a mesma tag+conta.
 *
 * Usa MongoClient DIRETO (não sobe o AppModule), mesmo padrão de
 * migrate-groups-setup-real.ts.
 *
 * Requer no .env: MONGO_URI.
 * Run: npx ts-node scripts/migrate-groups-to-stores.ts
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
    const groups = db.collection('groups');
    const stores = db.collection('stores');

    const groupDocs = await groups.find().toArray();
    console.log(`Encontrados ${groupDocs.length} documentos em 'groups'.`);

    let created = 0;
    let updated = 0;

    for (const g of groupDocs) {
      const legacyAccounts: Record<string, string> = g.accounts ?? {};
      const marketplaceAccounts = Object.entries(legacyAccounts).map(([marketplaceTag, accountId]) => ({
        marketplaceTag,
        accountId,
      }));

      const existing = await stores.findOne({ name: g.name });
      if (!existing) {
        await stores.insertOne({
          name: g.name,
          marketplaceAccounts,
          createdAt: g.createdAt ?? new Date(),
          updatedAt: new Date(),
        });
        created++;
        console.log(`  ✓ store criada: ${g.name} → ${JSON.stringify(marketplaceAccounts)}`);
        continue;
      }

      // Idempotência: mescla sem duplicar (tag,accountId) já presentes.
      const currentAccounts: Array<{ marketplaceTag: string; accountId: string }> =
        existing.marketplaceAccounts ?? [];
      const merged = [...currentAccounts];
      for (const entry of marketplaceAccounts) {
        const alreadyPresent = merged.some(
          (e) => e.marketplaceTag === entry.marketplaceTag && e.accountId === entry.accountId,
        );
        if (!alreadyPresent) merged.push(entry);
      }
      await stores.updateOne(
        { _id: existing._id },
        { $set: { marketplaceAccounts: merged, updatedAt: new Date() } },
      );
      updated++;
      console.log(`  ✓ store atualizada: ${g.name} → ${JSON.stringify(merged)}`);
    }

    console.log(`\nMigração concluída. created=${created} updated=${updated}.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
