import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { WebhookController } from './webhook.controller';
import { WebhookIngressService } from './ingress/webhook-ingress.service';
import { WebhookIngressGuard } from './ingress/webhook-ingress.guard';
import { SignatureVerifier } from './crypto/signature-verifier.service';
import { WebhookAdapterRegistry } from './adapters/webhook-adapter.registry';
import { WebhookInboxModel, WebhookInboxSchema } from './inbox/webhook-inbox.schema';
import { WebhookInboxService } from './inbox/webhook-inbox.service';
import { WebhookInboxWorker } from './inbox/webhook-inbox.worker';
import { WebhookDispatcher } from './dispatch/webhook-dispatcher.service';
import { WebhookMetricsService } from './observability/webhook-metrics.service';
import { MercadoLivreAdapter } from './adapters/mercadolivre.adapter';
import { ShopeeAdapter } from './adapters/shopee.adapter';
import { AmazonAdapter } from './adapters/amazon.adapter';
import { MagaluAdapter } from './adapters/magalu.adapter';
import { B2WAdapter } from './adapters/b2w.adapter';
import { ViaVarejoAdapter } from './adapters/viavarejo.adapter';
import { YampiAdapter } from './adapters/yampi.adapter';
import { OLXAdapter } from './adapters/olx.adapter';
import { AliExpressAdapter } from './adapters/aliexpress.adapter';
import { TikTokShopAdapter } from './adapters/tiktokshop.adapter';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    MongooseModule.forFeature([{ name: WebhookInboxModel.name, schema: WebhookInboxSchema }]),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookIngressService, WebhookIngressGuard, SignatureVerifier,
    WebhookAdapterRegistry, WebhookInboxService, WebhookInboxWorker,
    WebhookDispatcher, WebhookMetricsService,
    MercadoLivreAdapter, ShopeeAdapter, AmazonAdapter, MagaluAdapter, B2WAdapter,
    ViaVarejoAdapter, YampiAdapter, OLXAdapter, AliExpressAdapter, TikTokShopAdapter,
  ],
})
export class WebhookModule {}
