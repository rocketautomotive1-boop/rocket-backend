import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { MercadoLivreWebhookService } from './services/mercado-livre-webhook.service';
import { ShopeeWebhookService } from './services/shopee-webhook.service';
import { AmazonWebhookService } from './services/amazon-webhook.service';
import { MagaluWebhookService } from './services/magalu-webhook.service';
import { B2WWebhookService } from './services/b2w-webhook.service';
import { ViaVarejoWebhookService } from './services/via-varejo-webhook.service';
import { YampiWebhookService } from './services/yampi-webhook.service';
import { OLXWebhookService } from './services/olx-webhook.service';
import { AliExpressWebhookService } from './services/aliexpress-webhook.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
    private mercadoLivreWebhookService: MercadoLivreWebhookService,
    private shopeeWebhookService: ShopeeWebhookService,
    private amazonWebhookService: AmazonWebhookService,
    private magaluWebhookService: MagaluWebhookService,
    private b2wWebhookService: B2WWebhookService,
    private viaVarejoWebhookService: ViaVarejoWebhookService,
    private yampiWebhookService: YampiWebhookService,
    private olxWebhookService: OLXWebhookService,
    private aliExpressWebhookService: AliExpressWebhookService
  ) {}

  /**
   * Processar webhook do Mercado Livre
   */
  async processMercadoLivreWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.mercadoLivreWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da Shopee
   */
  async processShopeeWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.shopeeWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da Amazon
   */
  async processAmazonWebhook(topic: string, payload: any, messageType: string): Promise<any> {
    return this.amazonWebhookService.processWebhook(topic, payload, messageType);
  }

  /**
   * Processar webhook da Magazine Luiza
   */
  async processMagaluWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.magaluWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da B2W (Americanas, Submarino, Shoptime)
   */
  async processB2WWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.b2wWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da Via Varejo (Casas Bahia, Ponto Frio)
   */
  async processViaVarejoWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.viaVarejoWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da Yampi
   */
  async processYampiWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.yampiWebhookService.processWebhook(topic, payload, signature);
  }

  /**
   * Processar webhook da OLX
   */
  async processOLXWebhook(topic: string, payload: any): Promise<any> {
    return this.olxWebhookService.processWebhook(topic, payload);
  }

  /**
   * Processar webhook da AliExpress
   */
  async processAliExpressWebhook(topic: string, payload: any, signature: string): Promise<any> {
    return this.aliExpressWebhookService.processWebhook(topic, payload, signature);
  }
}
