export const CONFIRMED_STATUSES = new Set([
  'paid',
  'ready_to_ship',
  'shipped',
  'delivered',
  'payment_done',
]);

const NOTIFIED = new Set(['sent', 'queued', 'skipped_old', 'manual_required']);

export type IngestSource = 'webhook' | 'reconcile' | 'manual' | 'retry' | 'sync';

export interface ExistingOrderView {
  logisticsStatus?: string;
  status?: string;
  shippingSubstatus?: string;
  notificationStatus?: { whatsapp?: { status?: string } };
}

export interface IncomingOrderView {
  status?: string;
  shippingSubstatus?: string;
}

export type IngestAction =
  | { kind: 'CREATE_DEDUCT' }
  | { kind: 'CREATE_PENDING' }
  | { kind: 'UPSERT_DEDUCT' }
  | { kind: 'UPDATE_STATUS' }
  | { kind: 'UPDATE_SHIPPING' }
  | { kind: 'CANCEL' }
  | { kind: 'SKIP' }
  | { kind: 'RECOVER_NOTIFICATION' };

const lc = (s?: string) => (s ?? '').toLowerCase();
const isConfirmed = (s?: string) => CONFIRMED_STATUSES.has(lc(s));

/**
 * Pure idempotency decision for order ingestion. Given the locally-stored order (or null)
 * and the incoming external order, decide the single action the pipeline should take.
 * This encodes the rules previously inlined in OrderSyncPipeline.
 */
export function decideIngestAction(
  existing: ExistingOrderView | null,
  incoming: IncomingOrderView,
  _source: IngestSource,
): IngestAction {
  const inStatus = lc(incoming.status);

  if (!existing) {
    return isConfirmed(inStatus) ? { kind: 'CREATE_DEDUCT' } : { kind: 'CREATE_PENDING' };
  }

  if (existing.logisticsStatus === 'deducted') {
    if (inStatus !== lc(existing.status)) {
      return inStatus === 'cancelled' ? { kind: 'CANCEL' } : { kind: 'UPDATE_STATUS' };
    }
    // Status comercial igual, mas o ENVIO avançou (ex.: shipped → delivered). O webhook
    // orders_v2 dispara nessas transições de logística; sem isso elas caíam em SKIP e a
    // atualização de entrega era descartada. Delta-only: só dispara quando o substatus muda.
    const inSub = lc(incoming.shippingSubstatus);
    if (inSub && inSub !== lc(existing.shippingSubstatus)) {
      return { kind: 'UPDATE_SHIPPING' };
    }
    const wa = lc(existing.notificationStatus?.whatsapp?.status);
    return NOTIFIED.has(wa) ? { kind: 'SKIP' } : { kind: 'RECOVER_NOTIFICATION' };
  }

  return isConfirmed(inStatus) ? { kind: 'UPSERT_DEDUCT' } : { kind: 'CREATE_PENDING' };
}
