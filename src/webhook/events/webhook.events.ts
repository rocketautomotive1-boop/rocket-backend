export const WEBHOOK_DOMAIN_COMMANDS = {
  ORDER_SYNC_REQUESTED: 'order.sync_requested',
  ORDER_PACK_SYNC_REQUESTED: 'order.pack_sync_requested',
  QUESTION_INGEST_REQUESTED: 'question.ingest_requested',
} as const;

export interface OrderSyncRequestedCommand {
  marketplace: string;
  externalOrderId: string;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}

export interface OrderPackSyncRequestedCommand {
  marketplace: 'mercadolivre';
  externalPackId: string;
  resource: string;
  receivedAt: Date;
  source: 'webhook';
}

export interface QuestionIngestRequestedCommand {
  marketplace: 'mercadolivre';
  externalQuestionId: string;
  resource: string;
  receivedAt: Date;
}
