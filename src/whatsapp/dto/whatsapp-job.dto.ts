/**
 * Job de envio WhatsApp transportado pela fila (rocket.notifications/whatsapp.send).
 * Puramente de transporte — sem campos de domínio (order/pricing).
 */
export class WhatsAppJobDto {
  jobId: string;
  destination: string;
  content: string;
  correlationId?: string;
  metadata?: Record<string, any>;
  attempt?: number;
}
