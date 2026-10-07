// backend/scripts/rehome-sale-movements-to-listing-store.js
/**
 * Corrige movimentações de VENDA/ESTORNO lançadas na loja errada (incidente 7086768, 2026-10-07).
 *
 * Causa: StockLedgerProvider resolvia a loja da baixa pela StoreListing MAIS ANTIGA do produto.
 * Em produto multi-loja, a baixa ia para a loja errada (ex.: d0c -48, enquanto as 86 unidades
 * estavam em d0d). Código já corrigido (resolveStoreForSale); este script corrige o histórico.
 *
 * Para cada movimentação com orderId (outbound = venda, inbound com ref `cancel:` = estorno):
 *   loja certa = Listing.storeId do anúncio vendido (marketplaceId + item.externalId + productId).
 * Se difere da loja onde a movimentação está, RE-HOSPEDA o MESMO documento (sem criar ruído de
 * compensação) e move o saldo junto: devolve o efeito no lote/saldo da loja errada e aplica na certa.
 * Tudo numa transação por movimentação. Idempotente: depois de re-hospedada, não é mais divergente.
 * Guarda a origem em metadata.rehomedFrom (reversível/auditável).
 *
 * Não toca: movimentações sem pedido (entradas, ajustes, migração), anúncio sem Listing, produto
 * sem StoreListing na loja certa (relatado como `semStoreListingDestino` — decisão manual).
 *
 * Uso (mongosh, dentro do container do Mongo):
 *   mongosh ... rocket_db --eval 'var EXECUTE=false' --file scripts/rehome-sale-movements-to-listing-store.js   # dry-run
 *   mongosh ... rocket_db --eval 'var EXECUTE=true'  --file scripts/rehome-sale-movements-to-listing-store.js   # grava
 */
const EXEC = typeof EXECUTE !== 'undefined' && EXECUTE === true;
const stats = { analisadas: 0, ok: 0, divergentes: 0, semOrder: 0, semItem: 0, semListing: 0, semStoreListingDestino: 0, movidas: 0, erros: 0 };
const porProduto = {};
const produtosMovidos = new Set();
const relatorio = { semListing: [], semStoreListingDestino: [], erros: [] };

const slCache = new Map();
const getSL = (id) => { const k = String(id); if (!slCache.has(k)) slCache.set(k, db.store_listings.findOne({ _id: id })); return slCache.get(k); };

const cursor = db.store_listing_stock_movements.find({
  orderId: { $exists: true, $ne: null },
  type: { $in: ['outbound', 'inbound'] },
});

while (cursor.hasNext()) {
  const m = cursor.next();
  stats.analisadas++;
  const sl = getSL(m.storeListingId);
  if (!sl) { stats.semOrder++; continue; }
  const order = db.orders.findOne({ _id: ObjectId(String(m.orderId)) }, { marketplaceId: 1, items: 1, externalId: 1 });
  if (!order) { stats.semOrder++; continue; }
  const item = (order.items || []).find((i) => i.productId && String(i.productId) === String(sl.productId));
  if (!item || !item.externalId) { stats.semItem++; continue; }
  const listing = db.listings.findOne(
    { marketplaceId: order.marketplaceId, externalId: item.externalId, productId: sl.productId },
    { storeId: 1 },
  );
  if (!listing) { stats.semListing++; relatorio.semListing.push({ mov: String(m._id), order: order.externalId, item: item.externalId }); continue; }
  if (String(listing.storeId) === String(sl.storeId)) { stats.ok++; continue; }

  stats.divergentes++;
  const dest = db.store_listings.findOne({ productId: sl.productId, storeId: listing.storeId });
  if (!dest) {
    stats.semStoreListingDestino++;
    relatorio.semStoreListingDestino.push({ mov: String(m._id), order: order.externalId, produto: String(sl.productId), lojaCerta: String(listing.storeId) });
    continue;
  }
  const sign = m.type === 'outbound' ? -1 : 1; // efeito original no onHand
  const key = String(sl.productId);
  porProduto[key] = porProduto[key] || { movs: 0, efeito: 0, de: String(sl.storeId).slice(-3), para: String(listing.storeId).slice(-3) };
  porProduto[key].movs++;
  porProduto[key].efeito += sign * m.quantity;

  if (!EXEC) continue;

  const session = db.getMongo().startSession();
  try {
    session.startTransaction();
    const sdb = session.getDatabase(db.getName());
    const cond = m.condition || 'new';
    // lote da loja certa (um por storeListing+condição); cria se a loja ainda nunca teve estoque
    let lot = sdb.store_listing_stock_lots.findOne({ storeListingId: dest._id, condition: cond });
    if (!lot) {
      const ins = sdb.store_listing_stock_lots.insertOne({ storeListingId: dest._id, condition: cond, createdAt: new Date(), updatedAt: new Date(), __v: 0 });
      lot = { _id: ins.insertedId };
    }
    const boxId = m.fromBoxId || m.toBoxId || null;
    // desfaz o efeito na loja errada
    sdb.store_listing_stock_balances.updateOne(
      { storeListingId: m.storeListingId, lotId: m.lotId, boxId: boxId },
      { $inc: { onHand: -sign * m.quantity } },
    );
    // aplica na loja certa
    sdb.store_listing_stock_balances.updateOne(
      { storeListingId: dest._id, lotId: lot._id, boxId: boxId },
      { $inc: { onHand: sign * m.quantity, reserved: 0 }, $setOnInsert: { condition: cond, createdAt: new Date(), __v: 0 }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
    sdb.store_listing_stock_movements.updateOne(
      { _id: m._id },
      {
        $set: {
          storeListingId: dest._id,
          lotId: lot._id,
          updatedAt: new Date(),
          'metadata.rehomedFrom': { storeListingId: m.storeListingId, lotId: m.lotId, at: new Date(), reason: 'baixa na StoreListing mais antiga em vez da loja do anúncio vendido' },
        },
      },
    );
    session.commitTransaction();
    stats.movidas++;
    produtosMovidos.add(String(sl.productId));
  } catch (e) {
    try { session.abortTransaction(); } catch (_) { /* já abortada */ }
    stats.erros++;
    relatorio.erros.push({ mov: String(m._id), erro: String(e) });
  } finally {
    session.endSession();
  }
}

// Estoque por loja mudou => republica nos marketplaces (mesmo caminho do app: outbox -> product.sync.requested).
if (EXEC) {
  produtosMovidos.forEach((pid) => {
    db.outbox_messages.insertOne({
      exchange: 'rocket.orchestrator',
      routingKey: 'product.sync.requested',
      payload: { productId: pid, reason: 'stock_correction' },
      status: 'pending', attempts: 0, maxAttempts: 8,
      scheduledAt: new Date(), createdAt: new Date(), updatedAt: new Date(), __v: 0,
    });
  });
  print('outbox sync enfileirado para ' + produtosMovidos.size + ' produto(s)');
}

print('MODO: ' + (EXEC ? 'EXECUTE (gravou)' : 'DRY-RUN (nada gravado)'));
printjson(stats);
print('--- produtos afetados (efeito = variação líquida do onHand que SAI da loja "de" e ENTRA em "para"):');
Object.keys(porProduto).forEach((k) => {
  const p = db.products.findOne({ _id: ObjectId(k) }, { partNumber: 1 });
  const v = porProduto[k];
  print((p ? p.partNumber : k) + '  ' + v.de + '→' + v.para + '  movs=' + v.movs + '  onHand: loja' + v.de + ' ' + (v.efeito >= 0 ? '-' : '+') + Math.abs(v.efeito) + ', loja' + v.para + ' ' + (v.efeito >= 0 ? '+' : '-') + Math.abs(v.efeito));
});
if (relatorio.semListing.length) { print('--- sem Listing (primeiros 10):'); printjson(relatorio.semListing.slice(0, 10)); }
if (relatorio.semStoreListingDestino.length) { print('--- sem StoreListing destino:'); printjson(relatorio.semStoreListingDestino); }
if (relatorio.erros.length) { print('--- erros:'); printjson(relatorio.erros); }
