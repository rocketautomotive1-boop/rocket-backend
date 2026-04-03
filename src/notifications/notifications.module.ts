import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationBusService } from './notification-bus.service';
import { EmailService } from './email.service';
import { UserModel, UserSchema } from '../auth/schemas/user.schema';
import { NotificationModel, NotificationSchema } from './schemas/notification.schema';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';

// Order model
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';

// New imports for WhatsApp
import { PartnerModel, PartnerSchema } from './schemas/partner.schema';
import { NotificationLogModel, NotificationLogSchema } from './schemas/notification-log.schema';
import { BaileysWhatsAppProvider } from './providers/baileys-whatsapp.provider';
import { WhatsAppNotificationService } from './services/whatsapp-notification.service';
import { WhatsAppNotificationListener } from './listeners/whatsapp-notification.listener';
import { WhatsAppCancellationListener } from './listeners/whatsapp-cancellation.listener';
import { WhatsAppQueueWorker } from './workers/whatsapp-queue.worker';
import { WhatsAppController } from './controllers/whatsapp.controller';

// Bot
import { WhatsAppCommandRouter }     from './bot/whatsapp-command.router';
import { WhatsAppCommandDispatcher } from './bot/whatsapp-command.dispatcher';
import { WhatsAppCommandListener }   from './bot/whatsapp-command.listener';
import { BalanceMlQuery }            from './bot/queries/balance-ml.query';
import { SalesQuery }                from './bot/queries/sales.query';
import { PendingOrdersQuery }        from './bot/queries/pending-orders.query';
import { MovementsMlQuery }          from './bot/queries/movements-ml.query';
import { NotificationReconcilerService } from './services/notification-reconciler.service';
import { DailyReportService } from './services/daily-report.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: NotificationModel.name, schema: NotificationSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: PartnerModel.name, schema: PartnerSchema },
      { name: NotificationLogModel.name, schema: NotificationLogSchema },
    ]),
    AuthModule,
    OrderModule,
    MarketplaceModule,
  ],
  controllers: [NotificationsController, WhatsAppController],
  providers: [
    NotificationsService,
    NotificationBusService,
    EmailService,
    // WhatsApp provider (conditional based on WHATSAPP_ENABLED)
    {
      provide: BaileysWhatsAppProvider,
      useFactory: (configService: ConfigService, eventEmitter: EventEmitter2) => {
        const enabled = configService.get<string>('WHATSAPP_ENABLED', 'true') !== 'false';
        if (!enabled) {
          return {
            isConnected: () => false,
            sendMessage: async () => {},
            getStatus: async () => ({ connected: false, message: 'WhatsApp disabled' }),
            listGroups: async () => [],
          } as any;
        }
        return new BaileysWhatsAppProvider(configService, eventEmitter);
      },
      inject: [ConfigService, EventEmitter2],
    },
    WhatsAppNotificationService,
    WhatsAppNotificationListener,
    WhatsAppCancellationListener,
    WhatsAppQueueWorker,
    // Bot providers
    WhatsAppCommandRouter,
    WhatsAppCommandDispatcher,
    WhatsAppCommandListener,
    BalanceMlQuery,
    SalesQuery,
    PendingOrdersQuery,
    MovementsMlQuery,
    NotificationReconcilerService,
    DailyReportService,
  ],
  exports: [NotificationsService, NotificationBusService, EmailService, WhatsAppNotificationService],
})
export class NotificationsModule { }