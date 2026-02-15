import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as axios from 'axios';

@Injectable()
export class AmazonWebhookService {
  private readonly logger = new Logger(AmazonWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da Amazon
   */
  async processWebhook(topic: string, payload: any, messageType: string): Promise<any> {
    this.logger.log(`Processando webhook da Amazon: ${topic}, tipo: ${messageType}`);
    
    try {
      // Verificar tipo de mensagem SNS
      if (messageType === 'SubscriptionConfirmation') {
        // Confirmar assinatura SNS
        await this.confirmSubscription(payload);
        return { success: true, message: 'Assinatura confirmada com sucesso' };
      }
      
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-amazon', {
        topic,
        payload,
        messageType,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da Amazon adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da Amazon: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Confirmar assinatura SNS da Amazon
   */
  private async confirmSubscription(payload: any): Promise<void> {
    try {
      const subscribeUrl = payload.SubscribeURL;
      
      if (!subscribeUrl) {
        throw new Error('URL de confirmação não encontrada');
      }
      
      // Fazer requisição HTTP para confirmar assinatura
      await axios.default.get(subscribeUrl);
      
      this.logger.log('Assinatura SNS da Amazon confirmada com sucesso');
    } catch (error) {
      this.logger.error(`Erro ao confirmar assinatura SNS da Amazon: ${error.message}`, error.stack);
      throw error;
    }
  }
}
