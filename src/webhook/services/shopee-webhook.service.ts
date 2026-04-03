import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../../notifications/notifications.service';
import * as crypto from 'crypto';

@Injectable()
export class ShopeeWebhookService {
  private readonly logger = new Logger(ShopeeWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) { }

  /**
   * Processar webhook da Shopee
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook da Shopee: ${topic}`);

    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook da Shopee');
      return { success: false, message: 'Assinatura inválida' };
    }

    try {
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-shopee', {
        topic,
        payload,
        receivedAt: new Date(),
      });

      this.logger.log(`Webhook da Shopee adicionado à fila: ${topic}`);

      // Push notifications now handled centrally by WebhookOrderDispatcher + NotificationBus

      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da Shopee: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura da Shopee
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;

    try {
      const partnerId = payload.partner_id;
      const partnerSecret = this.configService.get(`SHOPEE_PARTNER_SECRET_${partnerId}`);

      if (!partnerSecret) {
        this.logger.warn(`Secret para verificação de assinatura da Shopee não configurado para partner_id ${partnerId}`);
        return false;
      }

      const baseString = `${partnerId}${JSON.stringify(payload)}`;
      const calculatedSignature = crypto.createHmac('sha256', partnerSecret)
        .update(baseString)
        .digest('hex');

      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura da Shopee: ${error.message}`, error.stack);
      return false;
    }
  }
}
