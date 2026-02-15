import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class MagaluWebhookService {
  private readonly logger = new Logger(MagaluWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da Magazine Luiza
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook da Magazine Luiza: ${topic}`);
    
    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook da Magazine Luiza');
      return { success: false, message: 'Assinatura inválida' };
    }
    
    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-magalu', {
        topic,
        payload,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da Magazine Luiza adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da Magazine Luiza: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura da Magazine Luiza
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;
    
    try {
      const secret = this.configService.get('MAGALU_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn('Secret para verificação de assinatura da Magazine Luiza não configurado');
        return false;
      }
      
      const hmac = crypto.createHmac('sha256', secret);
      const calculatedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
      
      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura da Magazine Luiza: ${error.message}`, error.stack);
      return false;
    }
  }
}
