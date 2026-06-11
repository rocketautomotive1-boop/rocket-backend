// scripts/audit-orphan-sales.js
// READ-ONLY. Lista stock_movements de venda (reason começa com "Venda ") com orderId null
// e SEM Order correspondente (por metadata.externalReference == orders.externalId).
// Esses são os órfãos deixados pelo caminho legado (dedução direta sem criar Order).
const { MongoClient } = require('mongodb');
require('dotenv').config();

(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db();

  const movements = await db.collection('stock_movements').find({
    type: 'outbound',
    orderId: null,
    reason: { $regex: '^Venda ' },
    'metadata.externalReference': { $ne: null },
  }).toArray();

  const orphans = [];
  for (const m of movements) {
    const ext = m.metadata?.externalReference;
    if (!ext) continue;
    const order = await db.collection('orders').findOne({ externalId: ext }, { projection: { _id: 1 } });
    if (!order) {
      orphans.push({ externalId: ext, productId: String(m.productId), reason: m.reason, qty: m.quantity, date: m.date });
    }
  }

  console.log(`Total venda-movements órfãos (sem Order): ${orphans.length}`);
  for (const o of orphans) console.log(JSON.stringify(o));

  await client.close();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
