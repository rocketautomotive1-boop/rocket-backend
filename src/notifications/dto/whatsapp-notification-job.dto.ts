export class WhatsAppNotificationJobDto {
  jobId: string; // UUID unique

  destination: string; // WhatsApp group ID ou phone (e.g., '120363xxx@g.us' ou '5511999999999')

  content: string; // Mensagem em texto/markdown

  orderId?: string; // Link para order (para tracking)

  externalOrderId?: string; // ML-123456, SHP-789, etc

  metadata?: Record<string, any>; // Dados da venda para auditoria

  attempt?: number; // Qual tentativa (1, 2, 3...)

  maxAttempts?: number; // Default: 3

  delayMs?: number; // Delay antes de processar (para retry backoff)
}
