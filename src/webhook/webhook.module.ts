import { Module, forwardRef } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderModule } from '../order/order.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookOrderDispatcher } from './consumers/webhook-order-dispatcher.service';
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

@Module({
  imports: [
    ConfigModule,
    NotificationsModule,
    forwardRef(() => OrderModule),
    forwardRef(() => MarketplaceModule),
    ClientsModule.registerAsync([
      {
        name: 'MARKETPLACE_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672'],
            queue: configService.get<string>('MARKETPLACE_QUEUE') || 'marketplace_integration',
            queueOptions: {
              durable: true,
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookOrderDispatcher,
    MercadoLivreWebhookService,
    ShopeeWebhookService,
    AmazonWebhookService,
    MagaluWebhookService,
    B2WWebhookService,
    ViaVarejoWebhookService,
    YampiWebhookService,
    OLXWebhookService,
    AliExpressWebhookService,
    TikTokShopWebhookService,
  ],
  exports: [WebhookService],
})
export class WebhookModule { }
