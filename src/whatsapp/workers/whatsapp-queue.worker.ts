import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { WhatsAppJobDto } from '../dto/whatsapp-job.dto';

export const WHATSAPP_EXCHANGE = 'rocket.notifications';
export const WHATSAPP_ROUTING_KEY = 'whatsapp.send';
export const WHATSAPP_QUEUE = 'q.whatsapp.send';
export const WHATSAPP_DLQ_EXCHANGE = 'rocket.notifications.dlq';
export const WHATSAPP_DLQ_ROUTING_KEY = 'whatsapp.failed';

/**
 * Worker de transporte: processa jobs de envio WhatsApp com retry exponencial e DLQ.
 * Não conhece domínio nem persiste status de negócio — apenas entrega a mensagem.
 */
@Injectable()
export class WhatsAppQueueWorker {
  private logger = new Logger(WhatsAppQueueWorker.name);

  private readonly RETRY_DELAYS_MS = [30000, 60000, 120000]; // 30s, 60s, 120s
  private readonly MAX_ATTEMPTS = this.RETRY_DELAYS_MS.length + 1; // 4 tentativas

  constructor(
    private baileysProvider: BaileysWhatsAppProvider,
    private amqpConnection: AmqpConnection,
  ) {}

  @RabbitSubscribe({
    exchange: WHATSAPP_EXCHANGE,
    routingKey: WHATSAPP_ROUTING_KEY,
    queue: WHATSAPP_QUEUE,
    queueOptions: {
      durable: true,
      arguments: { 'x-max-priority': 10 },
    },
  })
  async handleWhatsAppJob(job: WhatsAppJobDto): Promise<void> {
    const { jobId, destination, content, attempt = 1 } = job;

    this.logger.debug(
      `Processing WhatsApp job ${jobId} for ${destination} (attempt ${attempt}/${this.MAX_ATTEMPTS})`,
    );

    try {
      await this.baileysProvider.sendMessage(destination, content);
      this.logger.log(`✅ WhatsApp message delivered: ${jobId}`);
    } catch (error) {
      this.logger.warn(
        `❌ WhatsApp send failed (attempt ${attempt}/${this.MAX_ATTEMPTS}): ${error.message}`,
      );

      if (attempt < this.MAX_ATTEMPTS) {
        const delayMs = this.RETRY_DELAYS_MS[attempt - 1];
        this.requeue(job, delayMs);
        this.logger.log(`🔄 Job ${jobId} requeued after ${delayMs}ms (attempt ${attempt})`);
      } else {
        await this.sendToDLQ(job, error.message);
        this.logger.error(`💀 Job ${jobId} moved to DLQ after ${attempt} attempts`);
      }
    }
  }

  /** Republish com delay (setTimeout — suficiente; sem plugin x-delayed). */
  private requeue(job: WhatsAppJobDto, delayMs: number): void {
    setTimeout(async () => {
      try {
        await this.amqpConnection.publish(WHATSAPP_EXCHANGE, WHATSAPP_ROUTING_KEY, {
          ...job,
          attempt: (job.attempt || 1) + 1,
        });
      } catch (error) {
        this.logger.error(`Failed to requeue job ${job.jobId}: ${error.message}`);
      }
    }, delayMs);
  }

  private async sendToDLQ(job: WhatsAppJobDto, errorMessage: string): Promise<void> {
    try {
      await this.amqpConnection.publish(WHATSAPP_DLQ_EXCHANGE, WHATSAPP_DLQ_ROUTING_KEY, {
        ...job,
        failureReason: errorMessage,
        failedAt: new Date(),
      });
      this.logger.log(`Job ${job.jobId} sent to DLQ for manual review`);
    } catch (error) {
      this.logger.error(`Failed to send job to DLQ: ${error.message}`);
    }
  }

  @RabbitSubscribe({
    exchange: WHATSAPP_DLQ_EXCHANGE,
    routingKey: WHATSAPP_DLQ_ROUTING_KEY,
    queue: 'q.whatsapp.send.dlq',
    queueOptions: { durable: true },
  })
  async handleDLQJob(dlqJob: any): Promise<void> {
    this.logger.warn(
      `DLQ job ${dlqJob.jobId} received for manual review. Reason: ${dlqJob.failureReason}`,
    );
  }
}
