import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MercadoLivreWebhookService } from './services/mercado-livre-webhook.service';
import { ShopeeWebhookService } from './services/shopee-webhook.service';
import { AmazonWebhookService } from './services/amazon-webhook.service';
import { MagaluWebhookService } from './services/magalu-webhook.service';
import { B2WWebhookService } from './services/b2w-webhook.service';
import { ViaVarejoWebhookService } from './services/via-varejo-webhook.service';
import { YampiWebhookService } from './services/yampi-webhook.service';
import { OLXWebhookService } from './services/olx-webhook.service';
import { AliExpressWebhookService } from './services/aliexpress-webhook.service';
import { TikTokShopWebhookService } from './services/tiktok-shop-webhook.service';
import { WebhookInboxService } from './services/webhook-inbox.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private mercadoLivreWebhookService: MercadoLivreWebhookService,
    private shopeeWebhookService: ShopeeWebhookService,
    private amazonWebhookService: AmazonWebhookService,
    private magaluWebhookService: MagaluWebhookService,
    private b2wWebhookService: B2WWebhookService,
    private viaVarejoWebhookService: ViaVarejoWebhookService,
    private yampiWebhookService: YampiWebhookService,
    private olxWebhookService: OLXWebhookService,
    private aliExpressWebhookService: AliExpressWebhookService,
    private tiktokShopWebhookService: TikTokShopWebhookService,
    private webhookInboxService: WebhookInboxService,
  ) {}

  /**
   * Processar webhook do Mercado Livre
   */
  async processMercadoLivreWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.mercadoLivreWebhookService.processWebhook(topic, payload, signature);

    if (this.shouldUseInboxForMl(topic, payload)) {
      const { record, isNew } = await this.webhookInboxService.store({
        marketplace: 'mercadolivre',
        topic,
        payload,
      });
      this.logger.debug(
        `[WebhookService] ML webhook stored in inbox id=${record._id} topic=${topic} isNew=${isNew}`,
      );
      return result;
    }

    this.eventEmitter.emit('webhook.received', { marketplace: 'mercadolivre', topic, payload });
    return result;
  }

  /**
   * Processar webhook da Shopee
   */
  async processShopeeWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.shopeeWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'shopee', topic, payload });
    return result;
  }

  /**
   * Processar webhook da Amazon
   */
  async processAmazonWebhook(topic: string, payload: any, messageType: string): Promise<any> {
    const result = await this.amazonWebhookService.processWebhook(topic, payload, messageType);
    this.eventEmitter.emit('webhook.received', { marketplace: 'amazon', topic, payload });
    return result;
  }

  /**
   * Processar webhook da Magazine Luiza
   */
  async processMagaluWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.magaluWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'magalu', topic, payload });
    return result;
  }

  /**
   * Processar webhook da B2W (Americanas, Submarino, Shoptime)
   */
  async processB2WWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.b2wWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'b2w', topic, payload });
    return result;
  }

  /**
   * Processar webhook da Via Varejo (Casas Bahia, Ponto Frio)
   */
  async processViaVarejoWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.viaVarejoWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'viavarejo', topic, payload });
    return result;
  }

  /**
   * Processar webhook da Yampi
   */
  async processYampiWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.yampiWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'yampi', topic, payload });
    return result;
  }

  /**
   * Processar webhook da OLX
   */
  async processOLXWebhook(topic: string, payload: any): Promise<any> {
    const result = await this.olxWebhookService.processWebhook(topic, payload);
    this.eventEmitter.emit('webhook.received', { marketplace: 'olx', topic, payload });
    return result;
  }

  /**
   * Processar webhook da AliExpress
   */
  async processAliExpressWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.aliExpressWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'aliexpress', topic, payload });
    return result;
  }

  /**
   * Processar webhook do TikTok Shop
   */
  async processTikTokShopWebhook(topic: string, payload: any, signature: string): Promise<any> {
    const result = await this.tiktokShopWebhookService.processWebhook(topic, payload, signature);
    this.eventEmitter.emit('webhook.received', { marketplace: 'tiktokshop', topic, payload });
    return result;
  }

  private shouldUseInboxForMl(topic: string, payload: any): boolean {
    if (!this.webhookInboxService.isEnabledForMarketplace('mercadolivre')) return false;

    const normalizedTopic = String(topic || '').toLowerCase();
    if (normalizedTopic === 'orders_v2') return true;

    const resource = String(payload?.resource || '');
    return resource.startsWith('/orders/') || resource.startsWith('/packs/');
  }
}
