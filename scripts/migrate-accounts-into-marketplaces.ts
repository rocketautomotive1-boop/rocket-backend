// backend/scripts/migrate-accounts-into-marketplaces.ts
/**
 * Migração idempotente: consolida a auth de marketplace num único modelo,
 * sintetizando marketplaces.accounts[] a partir do token legado em
 * marketplaces.tokens[] (e, se existissem, das contas em marketplace_accounts).
 *
 * IMPORTANTE (cutover): o broker já lê SOMENTE marketplaces.accounts[] (sem
 * fallback). Rode esta migração ANTES do deploy do código novo. Não dropa nada.
 *
 * Usa MongoClient DIRETO (não sobe o AppModule) para:
 *   - evitar side-effects (WhatsApp/RabbitMQ/scheduler);
 *   - fazer $set cirúrgico em accounts[] SEM revalidar o doc inteiro (há drift
 *     pré-existente em outros campos, ex. requirements, que não queremos tocar).
 *
 * Requer no .env: MONGO_URI e MP_CRYPTO_KEY (para cifrar credenciais, se preciso).
 * Run: npx ts-node scripts/migrate-accounts-into-marketplaces.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { buildMergedAccounts } from '../src/marketplace/auth/migration/build-merged-accounts';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');
  if (!process.env.MP_CRYPTO_KEY) throw new Error('MP_CRYPTO_KEY ausente no .env (necessária p/ cifrar credenciais).');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const marketplaces = db.collection('marketplaces');
    const legacy = db.collection('marketplace_accounts');

    const all = await marketplaces.find({}).toArray();
    let upserted = 0, synthesized = 0, reconciled = 0, written = 0;

    for (const mp of all) {
      const legacyAccounts = await legacy.find({ marketplaceId: mp._id }).toArray().catch(() => []);
      const activeLegacyToken = (mp.tokens || []).find((t: any) => t.isActive);

      const res = buildMergedAccounts({
        tag: mp.tag,
        currentAccounts: Array.isArray(mp.accounts) ? mp.accounts : [],
        legacyAccounts,
        activeLegacyToken,
        marketplaceHasClientId: !!mp.credentials?.clientId,
      });

      // $set cirúrgico — só accounts[], sem revalidar/regravar o resto do doc.
      await marketplaces.updateOne({ _id: mp._id }, { $set: { accounts: res.accounts } });
      written++;
      upserted += res.upserted;
      if (res.synthesized) synthesized++;
      if (res.reconciled) reconciled++;
      console.log(`  ✓ ${mp.tag || mp.name}: accounts=${res.accounts.length} (synth=${res.synthesized} reconc=${res.reconciled})`);
    }

    console.log(`\nMigration done. marketplaces=${all.length} written=${written} accountsUpserted=${upserted} synthesized=${synthesized} reconciled=${reconciled}. marketplace_accounts NÃO foi dropada.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
