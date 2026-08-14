/**
 * Formatação pura da mensagem de cancelamento em markdown WhatsApp.
 * Recebe um payload já resolvido (itens + contexto) pelo domínio (order/) — o tradutor
 * NÃO lê o banco; espelha a convenção da mensagem de venda (sale-message.formatter).
 */
export interface CancellationMessagePayload {
  externalId: string;
  marketplace: string;
  /** Data real da venda no marketplace (marketplaceCreatedAt). ISO/Date. */
  soldAt?: string | Date | null;
  firstItemTitle?: string;
  firstQty?: number;
  /** Quantos itens além do primeiro o pedido tinha. */
  extraItemsCount?: number;
  totalAmount: number;
  cancelledBy: string | null;
  cancelReason: string | null;
  stockReverted: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CANCEL_REASON_LABELS: Record<string, string> = {
  buyer_cancel_express: 'Solicitação do comprador',
  buyer_cancel: 'Solicitação do comprador',
  seller_cancel: 'Cancelamento pelo vendedor',
  out_of_stock: 'Produto sem estoque',
  product_not_found: 'Produto não encontrado',
  address_problems: 'Problema com endereço',
  payment_not_confirmed: 'Pagamento não confirmado',
  fraud: 'Fraude detectada',
  'There is a mediation with status cancel_purchase': 'Mediação de cancelamento',
};

// ML usa 'buyer'/'seller'/'respondent' (e grupos como 'buyer'/'seller'/'system') para
// quem pediu o cancelamento. 'respondent' = quem respondeu à mediação = o vendedor.
const CANCELLED_BY_LABELS: Record<string, string> = {
  buyer: 'Comprador',
  seller: 'Vendedor',
  respondent: 'Vendedor',
  collector: 'Vendedor',
  system: 'Sistema',
  admin: 'Mercado Livre',
};

export function formatCancellationMessage(p: CancellationMessagePayload): string {
  const reasonRaw = p.cancelReason ?? '';
  const reason = CANCEL_REASON_LABELS[reasonRaw] ?? (reasonRaw || 'Não informado');

  const byRaw = (p.cancelledBy ?? '').toLowerCase();
  const cancelledBy = CANCELLED_BY_LABELS[byRaw] ?? (p.cancelledBy || 'Sistema');

  const itemBlock: string[] = [];
  if (p.firstItemTitle) {
    itemBlock.push(``, `*${p.firstItemTitle}*`);
    if ((p.extraItemsCount ?? 0) > 0) itemBlock.push(`(+ ${p.extraItemsCount} item(ns))`);
    if (p.firstQty != null) itemBlock.push(`Quantidade: ${p.firstQty}`);
  }

  const dateLine = p.soldAt
    ? [`📅 Venda: ${new Date(p.soldAt).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`]
    : [];

  const lines = [
    `❌ *PEDIDO CANCELADO*`,
    `🏪 Marketplace: ${(p.marketplace ?? '').toUpperCase()}`,
    ...dateLine,
    ...itemBlock,
    ``,
    `💰 Valor: ${fmt(p.totalAmount)}`,
    `👤 Cancelado por: ${cancelledBy}`,
    `📋 Motivo: ${reason}`,
    ...(p.stockReverted ? [`♻️ Estoque revertido automaticamente`] : []),
    `🔗 Pedido: ${p.externalId}`,
  ];

  return lines.join('\n');
}
