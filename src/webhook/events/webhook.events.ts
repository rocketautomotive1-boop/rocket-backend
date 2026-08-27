export const WEBHOOK_DOMAIN_COMMANDS = {
  ORDER_SYNC_REQUESTED: 'order.sync_requested',
  ORDER_PACK_SYNC_REQUESTED: 'order.pack_sync_requested',
  SHIPMENT_SYNC_REQUESTED: 'order.shipment_sync_requested',
  QUESTION_INGEST_REQUESTED: 'question.ingest_requested',
  MODERATION_PROBE_REQUESTED: 'moderation.probe_requested',
  RETURN_INGEST_REQUESTED: 'return.ingest_requested',
} as const;

export interface OrderSyncRequestedCommand {
  marketplace: string;
  externalOrderId: string;
  /** Seller id no marketplace (ML user_id) → conta multi-client destino. */
  externalUserId?: string | null;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}

export interface OrderPackSyncRequestedCommand {
  marketplace: 'mercadolivre';
  externalPackId: string;
  /** Seller id no marketplace (ML user_id) → conta multi-client destino. */
  externalUserId?: string | null;
  resource: string;
  receivedAt: Date;
  source: 'webhook';
}

/**
 * Mudança de status/substatus do envio (ML topic `shipments`) — resource é
 * `/shipments/{shipment_id}`, não o id do pedido. O listener resolve
 * shipment↔order via API antes de reingerir (mesmo padrão de expandMlPack).
 */
export interface ShipmentSyncRequestedCommand {
  marketplace: 'mercadolivre';
  externalShipmentId: string;
  /** Seller id no marketplace (ML user_id) → conta multi-client destino. */
  externalUserId?: string | null;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}

export interface QuestionIngestRequestedCommand {
  marketplace: 'mercadolivre';
  externalQuestionId: string;
  resource: string;
  receivedAt: Date;
}

/**
 * Low-latency trigger: an `items` webhook hinted that a listing may be moderated. The moderation
 * module probes /infractions (or /last_moderation) for this item — the reconciler is still the
 * authoritative source of truth; this just surfaces the change sooner.
 */
export interface ModerationProbeRequestedCommand {
  marketplace: string;
  /** Listing id at the marketplace (ML item id). */
  externalId: string;
  /** Seller id no marketplace (ML user_id) → conta multi-client destino. */
  externalUserId?: string | null;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}

/**
 * Pós-venda: comprador abriu uma reclamação/devolução (ML topic `claims`). O listener resolve a
 * conta dona via broker, busca o claim na API e notifica (app + WhatsApp). Detector, não executor.
 */
export interface ReturnIngestRequestedCommand {
  marketplace: string;
  /** Claim id no marketplace (ML claim id). */
  externalId: string;
  /** Seller id no marketplace (ML user_id) → conta multi-client destino. */
  externalUserId?: string | null;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}
