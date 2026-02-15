import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OLXWebhookService {
  private readonly logger = new Logger(OLXWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da OLX
   */
  async processWebhook(topic: string, payload: any): Promise<any> {
    this.logger.log(`Processando webhook da OLX: ${topic}`);
    
    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-olx', {
        topic,
        payload,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da OLX adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da OLX: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }
}
