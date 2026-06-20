import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import { BaileysWhatsAppProvider } from './providers/baileys-whatsapp.provider';
import {
  WhatsAppPort,
  WhatsAppOutboundMessage,
  WhatsAppStatus,
  WhatsAppGroup,
} from './whatsapp.port';
import { WhatsAppJobDto } from './dto/whatsapp-job.dto';
import { WHATSAPP_EXCHANGE, WHATSAPP_ROUTING_KEY } from './workers/whatsapp-queue.worker';

/**
 * Implementação do WHATSAPP_PORT. Fina: enfileira (entrega garantida) ou envia
 * já (request-reply do bot). Nada de domínio aqui.
 */
@Injectable()
export class WhatsAppTransportService implements WhatsAppPort {
  private readonly logger = new Logger(WhatsAppTransportService.name);
  private readonly groupId: string;

  constructor(
    private readonly provider: BaileysWhatsAppProvider,
    private readonly configService: ConfigService,
    private readonly amqpConnection: AmqpConnection,
  ) {
    this.groupId = this.configService.get('WHATSAPP_GROUP_ID', '');
  }

  async enqueue(message: WhatsAppOutboundMessage): Promise<void> {
    const job: WhatsAppJobDto = {
      jobId: randomUUID(),
      destination: message.destination || this.groupId,
      content: message.content,
      correlationId: message.correlationId,
      metadata: message.metadata,
      attempt: 1,
    };

    try {
      await this.amqpConnection.publish(WHATSAPP_EXCHANGE, WHATSAPP_ROUTING_KEY, job);
      this.logger.debug(`WhatsApp message enqueued (jobId: ${job.jobId})`);
    } catch (error) {
      // Fire-and-forget: nunca falha o chamador.
      this.logger.error(`Error enqueueing WhatsApp message: ${error.message}`);
    }
  }

  async sendNow(destination: string, text: string): Promise<void> {
    await this.provider.sendMessage(destination || this.groupId, text);
  }

  getStatus(): Promise<WhatsAppStatus> {
    return this.provider.getStatus();
  }

  listGroups(): Promise<WhatsAppGroup[]> {
    return this.provider.listGroups();
  }

  getQRCode(): Promise<string | null> {
    return this.provider.getQRCode();
  }
}
