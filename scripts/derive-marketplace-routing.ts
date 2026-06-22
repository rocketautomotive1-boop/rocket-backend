// backend/scripts/derive-marketplace-routing.ts
/**
 * Migração idempotente: deriva o mapa EXPLÍCITO `marketplaces.routing` a partir
 * do vínculo implícito legado `accounts[].domains`. A partir daqui o roteamento
 * de publicação é controlado pela tela de Configurações (seletor por domínio).
 *
 * Regra: para cada domínio canônico ('autopecas' | 'general'), `routing[dom]` =
 * id da PRIMEIRA conta cujo `domains` inclui esse domínio (mesma precedência que
 * o `accountFor` legado usava). Domínio sem conta correspondente NÃO recebe
 * entrada (fica "ausente" → fallback isDefault/1ª, comportamento atual).
 *
 * NÃO remove `accounts[].domains` — o schema ainda o lê como fallback enquanto
 * `routing` não cobre o domínio. A remoção de `domains[]` é um passo posterior,
 * feito só depois de confirmar que `routing` está populado e validado na tela.
 *
 * Usa MongoClient DIRETO (sem subir o AppModule) para evitar side-effects e
 * fazer $set cirúrgico só em `routing`. Idempotente: re-rodar = mesmo resultado.
 *
 * Requer no .env: MONGO_URI.
 * Run: npx ts-node scripts/derive-marketplace-routing.ts
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const CANONICAL_DOMAINS = ['autopecas', 'general'] as const;

/** Normaliza o drift histórico 'autoparts' → 'autopecas'. */
function canonicalDomain(d?: string): string {
  return d === 'autoparts' ? 'autopecas' : (d || 'autopecas');
}

/** Deriva { dom → accountId } a partir de accounts[].domains (1ª conta que atende). */
export function deriveRouting(accounts: any[]): Record<string, string> {
  const routing: Record<string, string> = {};
  for (const dom of CANONICAL_DOMAINS) {
    const match = (accounts ?? []).find((a) =>
      (a.domains ?? []).map(canonicalDomain).includes(dom),
    );
    if (match?._id) routing[dom] = String(match._id);
  }
  return routing;
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
    let written = 0;

    for (const mp of all) {
      const accounts: any[] = Array.isArray(mp.accounts) ? mp.accounts : [];
      const derived = deriveRouting(accounts);

      // Merge: preserva entradas já configuradas na tela (inclusive `null`),
      // só preenche domínios ainda ausentes no routing atual.
      const current: Record<string, string | null> = mp.routing ?? {};
      const next: Record<string, string | null> = { ...current };
      for (const [dom, id] of Object.entries(derived)) {
        if (!Object.prototype.hasOwnProperty.call(current, dom)) next[dom] = id;
      }

      await marketplaces.updateOne({ _id: mp._id }, { $set: { routing: next } });
      written++;
      console.log(`  ✓ ${mp.tag || mp.name}: routing=${JSON.stringify(next)}`);
    }

    console.log(`\nDone. marketplaces=${all.length} written=${written}. accounts[].domains preservado (fallback).`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Routing derivation FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
