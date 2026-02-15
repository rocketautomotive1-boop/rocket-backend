import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class AliExpressWebhookService {
  private readonly logger = new Logger(AliExpressWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da AliExpress
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook da AliExpress: ${topic}`);
    
    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook da AliExpress');
      return { success: false, message: 'Assinatura inválida' };
    }
    
    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-aliexpress', {
        topic,
        payload,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da AliExpress adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da AliExpress: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura da AliExpress
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;
    
    try {
      const secret = this.configService.get('ALIEXPRESS_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn('Secret para verificação de assinatura da AliExpress não configurado');
        return false;
      }
      
      const stringToSign = this.buildStringToSign(payload);
      const calculatedSignature = crypto.createHmac('sha256', secret)
        .update(stringToSign)
        .digest('base64');
      
      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura da AliExpress: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Construir string para assinatura da AliExpress
   */
  private buildStringToSign(payload: any): string {
    // Implementação simplificada - em um sistema real, isso seguiria a documentação da AliExpress
    return JSON.stringify(payload);
  }
}
