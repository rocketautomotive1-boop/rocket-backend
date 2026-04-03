import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { NotificationLogModel } from '../schemas/notification-log.schema';
import { WhatsAppNotificationJobDto } from '../dto/whatsapp-notification-job.dto';

/**
 * Worker que processa jobs de notificação WhatsApp enfileirados
 * Implementa retry exponencial e Dead Letter Queue
 */
@Injectable()
export class WhatsAppQueueWorker {
  private logger = new Logger(WhatsAppQueueWorker.name);

  // Estratégia de retry exponencial
  private readonly RETRY_DELAYS_MS = [30000, 60000, 120000]; // 30s, 60s, 120s
  private readonly MAX_ATTEMPTS = this.RETRY_DELAYS_MS.length + 1; // 4 tentativas
  private readonly DLQ_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 horas

  constructor(
    @InjectModel('NotificationLogModel')
    private notificationLogModel: Model<NotificationLogModel>,
    private baileysProvider: BaileysWhatsAppProvider,
    private amqpConnection: AmqpConnection
  ) {}

  /**
   * Consome jobs da fila rocket.notifications / whatsapp.sale
   */
  @RabbitSubscribe({
    exchange: 'rocket.notifications',
    routingKey: 'whatsapp.sale',
    queue: 'q.whatsapp.notifications',
    queueOptions: {
      durable: true,
      arguments: {
        'x-max-priority': 10,
      },
    },
  })
  async handleWhatsAppJob(job: WhatsAppNotificationJobDto): Promise<void> {
    const { jobId, destination, content, attempt = 1 } = job;

    this.logger.debug(
      `Processing WhatsApp job ${jobId} for ${destination} (attempt ${attempt}/${this.MAX_ATTEMPTS})`
    );

    try {
      // 1. Enviar mensagem
      await this.baileysProvider.sendMessage(destination, content);

      // 2. Sucesso: marcar como delivered
      await this.notificationLogModel.findOneAndUpdate(
        { jobId },
        {
          status: 'delivered',
          deliveredAt: new Date(),
          attempts: attempt,
        }
      );

      this.logger.log(`✅ WhatsApp notification delivered: ${jobId}`);

    } catch (error) {
      this.logger.warn(
        `❌ WhatsApp send failed (attempt ${attempt}/${this.MAX_ATTEMPTS}): ${error.message}`
      );

      // 3. Falha: implementar retry exponencial
      if (attempt < this.MAX_ATTEMPTS) {
        const delayMs = this.RETRY_DELAYS_MS[attempt - 1];
        await this.requeue(job, delayMs);

        // Atualizar log
        await this.notificationLogModel.findOneAndUpdate(
          { jobId },
          {
            status: 'pending',
            attempts: attempt,
            error: error.message,
            nextRetryAt: new Date(Date.now() + delayMs),
            lastAttemptAt: new Date(),
          }
        );

        this.logger.log(
          `🔄 Job ${jobId} requeued after ${delayMs}ms (attempt ${attempt})`
        );

      } else {
        // 4. Excedeu tentativas: move para Dead Letter Queue
        await this.sendToDLQ(job, error.message);

        // Marcar como failed
        await this.notificationLogModel.findOneAndUpdate(
          { jobId },
          {
            status: 'failed',
            attempts: attempt,
            error: `Max retries exceeded: ${error.message}`,
            expireAt: new Date(), // TTL expiration
          }
        );

        this.logger.error(
          `💀 Job ${jobId} moved to DLQ after ${attempt} attempts`
        );
      }
    }
  }

  /**
   * Requeuea o job na fila principal com delay (delayed message)
   */
  private async requeue(job: WhatsAppNotificationJobDto, delayMs: number): Promise<void> {
    // NestJS RabbitMQ não suporta delayed delivery nativamente
    // Alternativas:
    // 1. RabbitMQ com plugin x-delayed-message-exchange
    // 2. Usar setTimeout + republish (simples, suficiente para MVP)
    // 3. Usar job scheduler tipo Bull

    // Para MVP, usar setTimeout + republish manual
    setTimeout(async () => {
      try {
        const nextAttempt = (job.attempt || 1) + 1;
        await this.amqpConnection.publish(
          'rocket.notifications',
          'whatsapp.sale',
          {
            ...job,
            attempt: nextAttempt,
          }
        );
      } catch (error) {
        this.logger.error(`Failed to requeue job ${job.jobId}: ${error.message}`);
      }
    }, delayMs);
  }

  /**
   * Envia job para Dead Letter Queue (configurado com retenção 24h)
   */
  private async sendToDLQ(job: WhatsAppNotificationJobDto, errorMessage: string): Promise<void> {
    try {
      await this.amqpConnection.publish(
        'rocket.notifications.dlq', // DLQ exchange (separado)
        'whatsapp.failed',
        {
          ...job,
          failureReason: errorMessage,
          failedAt: new Date(),
        }
      );

      this.logger.log(`Job ${job.jobId} sent to DLQ for manual review`);

    } catch (error) {
      this.logger.error(`Failed to send job to DLQ: ${error.message}`);
      // Fallback: log em arquivo ou datastore
    }
  }

  /**
   * (Opcional) Consumer para DLQ - permite admin reprocessar manualmente
   * Pode ser ativado se necessário
   */
  @RabbitSubscribe({
    exchange: 'rocket.notifications.dlq',
    routingKey: 'whatsapp.failed',
    queue: 'q.whatsapp.notifications.dlq',
    queueOptions: {
      durable: true,
    },
  })
  async handleDLQJob(dlqJob: any): Promise<void> {
    this.logger.warn(
      `DLQ job ${dlqJob.jobId} received for manual review. Reason: ${dlqJob.failureReason}`
    );

    // Aqui pode ser implementado:
    // - Alertar admin via email/Slack
    // - Registrar em tabela de erros críticos
    // - Retry manual via UI admin

    // Por enquanto, apenas log
  }
}
