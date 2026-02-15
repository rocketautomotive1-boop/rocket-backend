import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class B2WWebhookService {
  private readonly logger = new Logger(B2WWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da B2W (Americanas, Submarino, Shoptime)
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook da B2W: ${topic}`);
    
    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook da B2W');
      return { success: false, message: 'Assinatura inválida' };
    }
    
    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-b2w', {
        topic,
        payload,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da B2W adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da B2W: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura da B2W
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;
    
    try {
      const secret = this.configService.get('B2W_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn('Secret para verificação de assinatura da B2W não configurado');
        return false;
      }
      
      // B2W usa formato sha1=assinatura
      const [algorithm, hash] = signature.split('=');
      
      if (algorithm !== 'sha1' || !hash) {
        return false;
      }
      
      const hmac = crypto.createHmac('sha1', secret);
      const calculatedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
      
      return calculatedSignature === hash;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura da B2W: ${error.message}`, error.stack);
      return false;
    }
  }
}
