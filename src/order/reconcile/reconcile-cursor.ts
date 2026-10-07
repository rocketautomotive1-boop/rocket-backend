export const RECONCILE = {
  FLOOR_MS: 5 * 60 * 1000, // 5 min
  CEILING_MS: 20 * 60 * 1000, // 20 min
  BOOTSTRAP_WINDOW_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  TICK_MS: 30 * 1000, // frequência com que o supervisor procura checkpoints vencidos
  TARGET_REFRESH_MS: 5 * 60 * 1000, // redescobre marketplaces/contas (conta nova não exige restart)
  MAX_FAILED_ATTEMPTS: 8, // após isso o pedido vira `dead` (alerta), nunca é descartado
  RETRY_BASE_MS: 60 * 1000,
  RETRY_CEILING_MS: 60 * 60 * 1000,
  STALE_AFTER_MS: 3 * 20 * 60 * 1000, // 3× o teto de intervalo sem rodar = reconciler parado
};

/** Backoff exponencial por pedido que falhou: 1min, 2min, 4min… até 1h. */
export function failedRefBackoff(attempts: number): number {
  return Math.min(RECONCILE.RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RECONCILE.RETRY_CEILING_MS);
}

/**
 * Adaptive interval: on a clean run (no gaps found) the interval doubles up to the ceiling;
 * when a gap is found it resets to the floor so the next check happens sooner.
 */
export function nextInterval(current: number, cleanRun: boolean): number {
  if (!cleanRun) return RECONCILE.FLOOR_MS;
  return Math.min(current * 2, RECONCILE.CEILING_MS);
}

/** Highest date_last_updated among refs, or `fallback` when the delta is empty. */
export function maxCursor(refs: Array<{ date_last_updated: string }>, fallback: Date): Date {
  if (!refs.length) return fallback;
  return refs.reduce((acc, r) => {
    const d = new Date(r.date_last_updated);
    return d > acc ? d : acc;
  }, new Date(0));
}

/** Case-insensitive status comparison. */
export function isStatusDivergent(localStatus?: string, externalStatus?: string): boolean {
  return (localStatus ?? '').toLowerCase() !== (externalStatus ?? '').toLowerCase();
}

/**
 * Substatus de shipment que não mudam mais — uma vez aqui, não há gap a reconciliar
 * (delivered/not_delivered terminam o fluxo de entrega; cancelled é setado só no
 * cancelamento do pedido em si, não avança sozinho).
 */
const TERMINAL_SHIPPING_SUBSTATUSES = new Set(['delivered', 'not_delivered', 'cancelled']);

/**
 * True quando o pedido apareceu no delta (date_last_updated moveu no marketplace) mas
 * o shipping.substatus local ainda não está num estado terminal — o ML atualiza
 * date_last_updated do pedido em toda transição de shipment (confirmado ao vivo), então
 * isso cobre o caso em que o webhook (orders_v2 ou shipments) não entregou a atualização:
 * rede de segurança complementar ao handler do tópico `shipments`, não substituto dele.
 */
export function isShippingPossiblyStale(localSubstatus?: string): boolean {
  return !TERMINAL_SHIPPING_SUBSTATUSES.has((localSubstatus ?? '').toLowerCase());
}
