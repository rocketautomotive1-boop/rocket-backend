// backend/scripts/derive-active-account.ts
/**
 * Migração idempotente: define `marketplaces.activeAccountId` (conta ATIVA de
 * publicação) para marketplaces que ainda não têm uma. Substitui o roteamento
 * por domínio: a partir daqui cada marketplace publica por UMA conta ativa.
 *
 * Escolha da conta ativa (só quando activeAccountId está vazio):
 *   1) a conta marcada isDefault que tenha token; senão
 *   2) a primeira conta com token (accessToken presente).
 * Marketplaces sem conta com token ficam com activeAccountId = null (não publicam
 * até você escolher uma na tela).
 *
 * Idempotente: re-rodar não sobrescreve um activeAccountId já definido.
 * Usa MongoClient direto (sem subir o AppModule). Requer MONGO_URI no .env.
 * Run: npx ts-node scripts/derive-active-account.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

/** Escolhe a conta ativa: isDefault-com-token → 1ª-com-token → null. */
export function pickActiveAccountId(accounts: any[]): string | null {
  const withToken = (accounts ?? []).filter((a) => a?.token?.accessToken);
  if (withToken.length === 0) return null;
  const def = withToken.find((a) => a.isDefault);
  return String((def ?? withToken[0])._id);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const marketplaces = db.collection('marketplaces');
    const all = await marketplaces.find({}).toArray();
    let written = 0, skipped = 0;

    for (const mp of all) {
      // Não sobrescreve uma escolha já feita na tela.
      if (mp.activeAccountId) { skipped++; continue; }

      const accounts: any[] = Array.isArray(mp.accounts) ? mp.accounts : [];
      const activeAccountId = pickActiveAccountId(accounts);

      await marketplaces.updateOne({ _id: mp._id }, { $set: { activeAccountId } });
      written++;
      console.log(`  ✓ ${mp.tag || mp.name}: activeAccountId=${activeAccountId ?? 'null (sem conta com token)'}`);
    }

    console.log(`\nDone. marketplaces=${all.length} written=${written} skipped(já definido)=${skipped}.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Active-account derivation FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
