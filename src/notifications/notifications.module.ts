import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryModule } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';

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

// ── WhatsApp subsystem (kept intact) ──
// OrderModule is imported ONLY because the legacy WhatsApp listener
// (WhatsAppNotificationListener) injects OrderFinancialSummaryService, which is
// provided/exported by OrderModule. The NEW notification pipeline does NOT depend
// on any domain module. Extracting the WhatsApp subsystem into its own module
// (to drop this import) is out of scope for this task.
import { OrderModule } from '../order/order.module';
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';
// MarketplaceAuthModule is imported ONLY because the legacy WhatsApp bot queries
// (BalanceMlQuery, MovementsMlQuery) inject MercadoLivreAuthAdapter, which it exports.
// Narrower than the full MarketplaceModule the old module used; no cycle back to
// NotificationsModule. The NEW notification pipeline does NOT depend on it.
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { PartnerModel, PartnerSchema } from './schemas/partner.schema';
import { NotificationLogModel, NotificationLogSchema } from './schemas/notification-log.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../stock/schemas/stock-movement.schema';
import { StockModule } from '../stock/stock.module';
import { PricingModule } from '../pricing/pricing.module';
import { BaileysWhatsAppProvider } from './providers/baileys-whatsapp.provider';
import { WhatsAppNotificationService } from './services/whatsapp-notification.service';
import { WhatsAppNotificationListener } from './listeners/whatsapp-notification.listener';
import { WhatsAppCancellationListener } from './listeners/whatsapp-cancellation.listener';
import { WhatsAppQueueWorker } from './workers/whatsapp-queue.worker';
import { WhatsAppController } from './controllers/whatsapp.controller';
import { WhatsAppCommandRouter } from './bot/whatsapp-command.router';
import { WhatsAppCommandDispatcher } from './bot/whatsapp-command.dispatcher';
import { WhatsAppCommandListener } from './bot/whatsapp-command.listener';
import { WhatsAppCommandSession } from './bot/whatsapp-command.session';
import { BalanceMlQuery } from './bot/queries/balance-ml.query';
import { SalesQuery } from './bot/queries/sales.query';
import { PendingOrdersQuery } from './bot/queries/pending-orders.query';
import { MovementsMlQuery } from './bot/queries/movements-ml.query';
import { ProductSearchQuery } from './bot/queries/product-search.query';
import { NotificationReconcilerService } from './services/notification-reconciler.service';
import { DailyReportService } from './services/daily-report.service';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    AuthModule,
    OrderModule, // legacy WhatsApp subsystem only — see note above
    StockModule, // STOCK_QUERY_PORT for the product-search bot query
    PricingModule, // PRICING_PORT for the product-search bot query
    MarketplaceAuthModule, // legacy WhatsApp bot queries only — see note above
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: NotificationModel.name, schema: NotificationSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: PartnerModel.name, schema: PartnerSchema },
      { name: NotificationLogModel.name, schema: NotificationLogSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StockMovementModel.name, schema: StockMovementSchema },
    ]),
  ],
  controllers: [NotificationsController, DeviceController, WhatsAppController],
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
    // WhatsApp provider (conditional based on WHATSAPP_ENABLED)
    {
      provide: BaileysWhatsAppProvider,
      useFactory: (configService: ConfigService, eventEmitter: EventEmitter2) => {
        const enabled = configService.get<string>('WHATSAPP_ENABLED', 'true') !== 'false';
        if (!enabled) {
          return {
            isConnected: () => false, sendMessage: async () => {},
            getStatus: async () => ({ connected: false, message: 'WhatsApp disabled' }),
            listGroups: async () => [],
          } as any;
        }
        return new BaileysWhatsAppProvider(configService, eventEmitter);
      },
      inject: [ConfigService, EventEmitter2],
    },
    WhatsAppNotificationService, WhatsAppNotificationListener, WhatsAppCancellationListener,
    WhatsAppQueueWorker,
    WhatsAppCommandRouter, WhatsAppCommandDispatcher, WhatsAppCommandSession, WhatsAppCommandListener,
    BalanceMlQuery, SalesQuery, PendingOrdersQuery, MovementsMlQuery, ProductSearchQuery,
    NotificationReconcilerService, DailyReportService,
  ],
  exports: [NotificationReadService, EmailService, WhatsAppNotificationService],
})
export class NotificationsModule {}
