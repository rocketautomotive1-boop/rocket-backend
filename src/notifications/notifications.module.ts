import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryModule } from '@nestjs/core';

import { UserModel, UserSchema } from '../auth/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';
import { NotificationModel, NotificationSchema } from './schemas/notification.schema';
import { EmailService } from './email.service';

// Core pipeline
import { NotificationPipelineService } from './core/notification-pipeline.service';
import { NotificationDedupService } from './core/notification-dedup.service';
import { AudienceResolver } from './core/audience-resolver.service';

// Channels
import { NotificationChannelRegistry } from './channels/notification-channel.registry';
import { PushChannel } from './channels/push.channel';
import { WebsocketChannel } from './channels/websocket.channel';
import { EmailChannel } from './channels/email.channel';
import { WhatsappChannel } from './channels/whatsapp.channel';

// Delivery
import { DeliveryStatusService } from './delivery/delivery-status.service';
import { DeliveryRetryWorker } from './delivery/delivery-retry.worker';

// Gateway / read / device / ingest
import { NotificationsGateway } from './gateway/notifications.gateway';
import { NotificationReadService } from './read/notification-read.service';
import { NotificationsController } from './read/notifications.controller';
import { DeviceTokenService } from './device/device-token.service';
import { DeviceController } from './device/device.controller';
import { OrderNotificationTranslator } from './ingest/order-notification.translator';

// WhatsApp transport (port-only consumer — no Baileys/queue knowledge here)
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

// Bot (broker side): router + dispatcher + session + inbound listener. Consome read-ports
// (SALES/BALANCE/PRODUCT_INFO) implementados por Order/MarketplaceAuth/Product — importados
// só para receber os tokens. NÃO injeta OrderModel/ProductModel nem serviços concretos.
import { WhatsAppCommandRouter } from './bot/whatsapp-command.router';
import { WhatsAppCommandDispatcher } from './bot/whatsapp-command.dispatcher';
import { WhatsAppCommandSession } from './bot/whatsapp-command.session';
import { WhatsAppCommandListener } from './bot/whatsapp-command.listener';
import { OrderModule } from '../order/order.module';
import { ProductModule } from '../product/product.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    AuthModule,
    WhatsAppModule, // WHATSAPP_PORT (canal WhatsApp + bot reply)
    // Read-ports do bot (tokens exportados por estes módulos). Acíclico: nenhum deles
    // importa NotificationsModule de volta.
    OrderModule,
    ProductModule,
    MarketplaceAuthModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: NotificationModel.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController, DeviceController],
  providers: [
    // Core
    NotificationPipelineService, NotificationDedupService, AudienceResolver,
    // Channels
    NotificationChannelRegistry, PushChannel, WebsocketChannel, EmailChannel, WhatsappChannel,
    // Delivery
    DeliveryStatusService, DeliveryRetryWorker,
    // Gateway / read / device / ingest
    NotificationsGateway, NotificationReadService, DeviceTokenService, OrderNotificationTranslator,
    EmailService,
    // Bot (broker side)
    WhatsAppCommandRouter, WhatsAppCommandDispatcher, WhatsAppCommandSession, WhatsAppCommandListener,
  ],
  exports: [NotificationReadService, EmailService],
})
export class NotificationsModule {}
