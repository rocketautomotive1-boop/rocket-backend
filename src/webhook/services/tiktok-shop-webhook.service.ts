import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../../notifications/notifications.service';
import * as crypto from 'crypto';

@Injectable()
export class TikTokShopWebhookService {
  private readonly logger = new Logger(TikTokShopWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {}

  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook do TikTok Shop: ${topic}`);

    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook do TikTok Shop');
      return { success: false, message: 'Assinatura inválida' };
    }

    try {
      this.marketplaceClient.emit('webhook-tiktokshop', {
        topic,
        payload,
        receivedAt: new Date(),
      });

      this.logger.log(`Webhook do TikTok Shop adicionado à fila: ${topic}`);

      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook do TikTok Shop: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;

    try {
      const appSecret = this.configService.get<string>('TIKTOK_SHOP_APP_SECRET');

      if (!appSecret) {
        this.logger.warn('TIKTOK_SHOP_APP_SECRET não configurado para verificação de assinatura');
        return false;
      }

      const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const calculatedSignature = crypto
        .createHmac('sha256', appSecret)
        .update(bodyString)
        .digest('hex');

      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura do TikTok Shop: ${error.message}`, error.stack);
      return false;
    }
  }
}
