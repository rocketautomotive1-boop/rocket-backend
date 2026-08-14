// backend/scripts/backfill-listing-account.ts
/**
 * Backfill idempotente: define `listings.accountId` (conta multi-client DONA do
 * anúncio) para os anúncios do Mercado Livre que ainda não têm.
 *
 * Por que: a saída (UPDATE/DELETE/operacional) passou a rotear o token pela conta
 * DONA do listing, não pela conta ativa da tela. Anúncios criados antes disso não
 * têm accountId — sem ele, o UPDATE cai na conta ativa e dá 403 forbidden quando o
 * item pertence à OUTRA conta. Este backfill descobre o dono real e o carimba.
 *
 * Como descobre o dono (autoritativo, self-correcting):
 *   Para cada listing com externalId, faz GET /items/{externalId} com o token de
 *   CADA conta ML do marketplace. A conta cujo token retorna 200 E cujo
 *   token.additionalData.userId === item.seller_id é a DONA. Bate → carimba.
 *   Nenhuma conta lê o item (closed/removido/foreign) → loga e deixa sem accountId.
 *
 * Idempotente: só toca listings sem accountId; re-rodar é seguro.
 * Usa MongoClient direto (sem subir o AppModule). Requer MONGO_URI no .env.
 * Run:        npx ts-node scripts/backfill-listing-account.ts
 * Dry-run:    npx ts-node scripts/backfill-listing-account.ts --dry
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const ML_API = 'https://api.mercadolibre.com';
const ML_TAG = 'mercadolivre';

interface AccountProbe {
  accountId: string;
  label: string;
  userId: string | null;
  accessToken: string | null;
}

/** GET /items/{id} com um token; devolve seller_id (string) ou null (não-dono/erro). */
async function readItemSellerId(externalId: string, accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(`${ML_API}/items/${externalId}?attributes=id,seller_id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null; // 403 = não é dono; 404 = sumiu; etc.
    const body: any = await r.json().catch(() => null);
    return body?.seller_id != null ? String(body.seller_id) : null;
  } catch {
    return null;
  }
}

/** Descobre a conta dona de um item entre os probes (match por seller_id). */
async function resolveOwner(externalId: string, probes: AccountProbe[]): Promise<string | null> {
  for (const p of probes) {
    if (!p.accessToken) continue;
    const sellerId = await readItemSellerId(externalId, p.accessToken);
    if (sellerId && p.userId && sellerId === p.userId) return p.accountId;
    // Fallback: alguns itens não retornam seller_id no attributes reduzido, mas o
    // 200 já prova acesso (só o dono lê com token próprio a maioria dos campos).
    if (sellerId && !p.userId) return p.accountId;
  }
  return null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();

    const mp = await db.collection('marketplaces').findOne({ tag: ML_TAG });
    if (!mp) throw new Error(`marketplace tag=${ML_TAG} não encontrado`);
    const mlMarketplaceId = new ObjectId(mp._id);

    const probes: AccountProbe[] = (mp.accounts ?? []).map((a: any) => ({
      accountId: String(a._id),
      label: a.label,
      userId: a?.token?.additionalData?.userId != null ? String(a.token.additionalData.userId) : null,
      accessToken: a?.token?.accessToken ?? null,
    }));
    console.log(`Contas ML: ${probes.map((p) => `${p.label}(${p.userId ?? '?'})`).join(', ')}`);
    if (probes.filter((p) => p.accessToken).length === 0) {
      throw new Error('Nenhuma conta ML com accessToken — não dá para descobrir donos.');
    }

    const listings = db.collection('listings');
    const pending = await listings
      .find({
        marketplaceId: mlMarketplaceId,
        externalId: { $type: 'string' },
        accountId: { $exists: false },
      })
      .project({ _id: 1, externalId: 1 })
      .toArray();

    console.log(`Listings ML sem accountId com externalId: ${pending.length}${dry ? ' (DRY-RUN)' : ''}\n`);

    let stamped = 0, unresolved = 0;
    for (const l of pending) {
      const owner = await resolveOwner(String(l.externalId), probes);
      if (!owner) {
        unresolved++;
        console.log(`  ? ${l.externalId}: nenhuma conta lê o item (closed/removido/foreign) — deixado sem accountId`);
        continue;
      }
      if (!dry) {
        await listings.updateOne({ _id: l._id }, { $set: { accountId: new ObjectId(owner) } });
      }
      stamped++;
      const label = probes.find((p) => p.accountId === owner)?.label ?? owner;
      console.log(`  ✓ ${l.externalId} → ${label} (${owner})`);
    }

    console.log(`\nDone. total=${pending.length} carimbados=${stamped} sem-dono=${unresolved}${dry ? ' (nada gravado)' : ''}.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill listing.accountId FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
