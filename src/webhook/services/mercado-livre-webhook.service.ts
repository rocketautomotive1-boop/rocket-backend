import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../../notifications/notifications.service';
import * as crypto from 'crypto';

@Injectable()
export class MercadoLivreWebhookService {
  private readonly logger = new Logger(MercadoLivreWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) { }

  /**
   * Processar webhook do Mercado Livre
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    // this.logger.log(`Processando webhook do Mercado Livre: ${topic}`);

    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook do Mercado Livre');
      return { success: false, message: 'Assinatura inválida' };
    }

    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-mercadolivre', {
        topic,
        payload,
        receivedAt: new Date(),
      });

      // this.logger.log(`Webhook do Mercado Livre adicionado à fila: ${topic}`);

      // Enviar notificação push se for pergunta ou venda
      if (topic === 'questions') {
        const resourceId = (payload.resource || '').split('/').pop();
        this.notificationsService.notifyAllAdmins(
          'Nova Pergunta no Mercado Livre',
          'Toque para visualizar e responder',
          { type: 'question', id: resourceId, marketplace: 'mercadolivre' }
        ).catch(e => this.logger.error(`Erro ao enviar push: ${e.message}`));
      } else if (topic === 'orders_v2') {
        const resourceId = (payload.resource || '').split('/').pop();
        this.notificationsService.notifyAllAdmins(
          'Nova Venda no Mercado Livre!',
          'Toque para visualizar detalhes do pedido',
          { type: 'order', id: resourceId, marketplace: 'mercadolivre' }
        ).catch(e => this.logger.error(`Erro ao enviar push: ${e.message}`));
      }

      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook do Mercado Livre: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura do Mercado Livre
   */
  private verifySignature(payload: any, signature: string): boolean {
    // Moved check inside for logging
    // if (!signature) return false;

    try {
      const secret = this.configService.get('MERCADO_LIVRE_WEBHOOK_SECRET');
      if (!secret) {
        // this.logger.warn('Secret para verificação de assinatura do Mercado Livre não configurado. Aceitando webhook sem validação.');
        return true;
      }

      const hmac = crypto.createHmac('sha256', secret);
      const calculatedSignature = hmac.update(JSON.stringify(payload)).digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(calculatedSignature),
        Buffer.from(signature)
      );
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura do Mercado Livre: ${error.message}`, error.stack);
      return false;
    }
  }
}
