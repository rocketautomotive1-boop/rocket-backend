/**
 * Formatação pura da mensagem de cancelamento em markdown WhatsApp.
 */
export interface CancellationMessagePayload {
  externalId: string;
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

export function formatCancellationMessage(p: CancellationMessagePayload): string {
  const reasonRaw = p.cancelReason ?? '';
  const reason = CANCEL_REASON_LABELS[reasonRaw] ?? (reasonRaw || 'Não informado');
  const cancelledBy =
    p.cancelledBy === 'buyer' ? 'Comprador' :
    p.cancelledBy === 'seller' ? 'Vendedor' :
    p.cancelledBy ?? 'Sistema';

  const lines = [
    `❌ *Pedido Cancelado*`,
    ``,
    `📦 Pedido: ${p.externalId}`,
    `💰 Valor: ${fmt(p.totalAmount)}`,
    `👤 Cancelado por: ${cancelledBy}`,
    `📋 Motivo: ${reason}`,
    ...(p.stockReverted ? [`♻️ Estoque revertido automaticamente`] : []),
  ];

  return lines.join('\n');
}
