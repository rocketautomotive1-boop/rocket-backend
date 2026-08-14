/**
 * Formatação pura da mensagem de devolução/reclamação (claim) em markdown WhatsApp.
 * Recebe um payload já resolvido pelo domínio — o tradutor NÃO lê o banco. Espelha a
 * convenção das mensagens de venda/cancelamento (sale/cancellation formatters).
 */
export interface ReturnMessagePayload {
  claimId: string;
  marketplace: string;
  /** mediations | cancellations | returns | fulfillment */
  claimType?: string | null;
  /** claim | dispute | recontact | none */
  stage?: string | null;
  orderId?: string | null;
  buyerName?: string | null;
  firstItemTitle?: string | null;
  firstQty?: number | null;
  extraItemsCount?: number;
  totalAmount?: number | null;
  /** Data real da venda no marketplace. ISO/Date. */
  soldAt?: string | Date | null;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Tipo do claim no ML → rótulo PT-BR.
const CLAIM_TYPE_LABELS: Record<string, string> = {
  returns: 'Devolução',
  return: 'Devolução',
  mediations: 'Mediação',
  cancellations: 'Cancelamento',
  fulfillment: 'Logística (full)',
  ml_case: 'Reclamação',
};

// Estágio do claim → rótulo PT-BR (onde está no fluxo).
const STAGE_LABELS: Record<string, string> = {
  claim: 'Reclamação aberta',
  dispute: 'Em disputa/mediação',
  recontact: 'Recontato',
  none: 'Aberto',
  stale: 'Parado',
};

export function formatReturnMessage(p: ReturnMessagePayload): string {
  const typeRaw = (p.claimType ?? '').toLowerCase();
  const typeLabel = CLAIM_TYPE_LABELS[typeRaw] ?? 'Devolução / Reclamação';

  const stageRaw = (p.stage ?? '').toLowerCase();
  const stageLabel = STAGE_LABELS[stageRaw];

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
    `🔁 *DEVOLUÇÃO / RECLAMAÇÃO*`,
    `🏪 Marketplace: ${(p.marketplace ?? '').toUpperCase()}`,
    `🏷️ Tipo: ${typeLabel}`,
    ...(stageLabel ? [`📌 Situação: ${stageLabel}`] : []),
    ...dateLine,
    ...itemBlock,
    ...(p.buyerName ? [``, `👤 Comprador: ${p.buyerName}`] : []),
    ...(p.totalAmount != null ? [`💰 Valor: ${fmt(p.totalAmount)}`] : []),
    ...(p.orderId ? [`🔗 Pedido: ${p.orderId}`] : []),
    `🆔 Reclamação: ${p.claimId}`,
  ];

  return lines.join('\n');
}
