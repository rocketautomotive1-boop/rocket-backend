// scripts/reconcile-orphan-sales.js
// Reconcilia vendas órfãs (estoque deduzido pelo caminho legado SEM Order) criando a
// Order via pipeline transacional (OrderIngestService.ingest). A dedução de estoque é
// IDEMPOTENTE por metadata.externalReference, então NÃO duplica estoque — só cria a
// Order faltante + dispara pricing/outbox/sync.
//
// Uso:
//   node scripts/reconcile-orphan-sales.js            (DRY-RUN: só lista todos os órfãos)
//   node scripts/reconcile-orphan-sales.js --apply    (executa o ingest para cada órfão)
//
// Requer build atualizado (usa dist/): rode `npm run build` antes.
//
// Resolução do marketplaceId: o movimento legado NÃO guarda marketplaceId nem resolve
// por listing (externalReference é o ORDER id, não o listing id). Resolvemos pelo NOME
// embutido no reason ("Venda <Marketplace Name>") contra a coleção marketplaces.
const { NestFactory } = require('@nestjs/core');
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function buildMarketplaceNameMap(db) {
  const mks = await db.collection('marketplaces').find({}, { projection: { name: 1 } }).toArray();
  const map = new Map();
  for (const m of mks) map.set(String(m.name).trim().toLowerCase(), String(m._id));
  return map;
}

async function findOrphans(db) {
  const nameMap = await buildMarketplaceNameMap(db);
  // SEM limite: processa todos os movimentos de venda órfãos.
  const movements = await db.collection('stock_movements').find({
    type: 'outbound',
    orderId: null,
    reason: { $regex: '^Venda ' },
    'metadata.externalReference': { $ne: null },
  }).toArray();

  const seen = new Set();
  const orphans = [];
  for (const m of movements) {
    const ext = m.metadata?.externalReference;
    if (!ext || seen.has(ext)) continue; // dedup por externalId (uma Order por pedido)
    const order = await db.collection('orders').findOne({ externalId: ext }, { projection: { _id: 1 } });
    if (order) continue; // já tem Order — não é órfão
    seen.add(ext);

    // "Venda Mercado Livre" -> "mercado livre"
    const mktName = String(m.reason).replace(/^Venda\s+/i, '').trim().toLowerCase();
    const marketplaceId = nameMap.get(mktName) || null;
    orphans.push({ externalId: ext, marketplaceId, marketplaceName: mktName });
  }
  return orphans;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const orphans = await findOrphans(client.db());
  await client.close();

  console.log(`Órfãos (Orders faltantes): ${orphans.length}`);
  orphans.forEach(o => console.log(JSON.stringify(o)));

  const resolvable = orphans.filter(o => o.marketplaceId);
  const unresolvable = orphans.filter(o => !o.marketplaceId);
  if (unresolvable.length) {
    console.warn(`\nAVISO: ${unresolvable.length} sem marketplaceId resolvível pelo nome — serão pulados:`);
    unresolvable.forEach(o => console.warn('  ', o.externalId, `(reason name: "${o.marketplaceName}")`));
  }

  if (!apply) {
    console.log(`\nDRY-RUN. ${resolvable.length} reconciliáveis. Rode com --apply para executar.`);
    return;
  }

  // Bootstrap do Nest context (sem HTTP listen) para usar OrderIngestService.
  const { AppModule } = require('../dist/app.module');
  const { OrderIngestService } = require('../dist/order/ingest/order-ingest.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ingest = app.get(OrderIngestService);

  let ok = 0, fail = 0;
  for (const o of resolvable) {
    try {
      await ingest.ingest(o.externalId, o.marketplaceId, 'reconcile');
      console.log(`OK  ${o.externalId}`);
      ok++;
    } catch (e) {
      console.error(`ERR ${o.externalId}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nReconciliados: ${ok} | Falhas: ${fail} | Pulados(sem mkt): ${unresolvable.length}`);
  await app.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
