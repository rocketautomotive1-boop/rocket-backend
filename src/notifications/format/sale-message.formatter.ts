/**
 * Formatação pura (sem I/O) da mensagem de venda em markdown WhatsApp.
 * Recebe um payload já resolvido (financeiro + itens) pelo domínio (order/).
 */
export interface SaleMessagePayload {
  marketplace: string;
  createdAt: string | Date;
  firstItemTitle: string;
  extraItemsCount: number;
  firstQty: number;
  firstUnitPrice: number;
  itemsTotal: number;
  buyerName: string;
  externalId: string;
  financial: {
    gross: number;
    saleFee: number;
    freight: number;
    taxes: number;
    net: number;
    costTotal: number;
    grossProfit: number;
    marginPct: number;
  };
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function formatSaleMessage(p: SaleMessagePayload): string {
  const f = p.financial;
  const extraItems = p.extraItemsCount > 0 ? [`(+ ${p.extraItemsCount} item(ns))`] : [];

  const lines = [
    `📦 *NOVA VENDA*`,
    `🏪 Marketplace: ${(p.marketplace ?? '').toUpperCase()}`,
    `📅 Data: ${new Date(p.createdAt).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    ``,
    `*${p.firstItemTitle}*`,
    ...extraItems,
    `Quantidade vendida: ${p.firstQty}`,
    ...(p.firstUnitPrice > 0 ? [`Preço unitário: ${fmt(p.firstUnitPrice)}`] : []),
    `Total itens: ${fmt(p.itemsTotal)}`,
    ``,
    `💰 *Valor bruto:* ${fmt(f.gross)}`,
    ...(f.saleFee > 0 ? [`  └ Comissão: -${fmt(f.saleFee)}`] : []),
    ...(f.freight > 0 ? [`  └ Frete (vendedor): -${fmt(f.freight)}`] : []),
    ...(f.taxes > 0 ? [`  └ Impostos: -${fmt(f.taxes)}`] : []),
    `💵 *Receita líquida:* ${fmt(f.net)}`,
    ...(f.costTotal > 0 ? [`  └ Custo dos produtos: -${fmt(f.costTotal)}`] : []),
    ``,
    `✅ *Lucro bruto estimado:* ${fmt(f.grossProfit)}`,
    `📈 *Margem:* ${f.marginPct.toFixed(1)}%`,
    ``,
    `👤 Comprador: ${p.buyerName || 'N/A'}`,
    `🔗 Pedido: ${p.externalId}`,
  ];

  return lines.join('\n');
}
