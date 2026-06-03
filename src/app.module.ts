import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProductModule } from './product/product.module';
import { MarketplaceModule } from './marketplace/marketplace.module';

import { QueueModule } from './queue/queue.module';
import { RabbitMqModule } from './common/rabbitmq/rabbitmq.module';
import { AuthModule } from './auth/auth.module';
import { WebhookModule } from './webhook/webhook.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { StatsModule } from './stats/stats.module';
import { CompatibilityModule } from './compatibility/compatibility.module';
import { CompatibilitiesModule } from './compatibilities/compatibilities.module';
import { OLXModule } from './marketplace/adapters/olx/olx.module';
import { AiModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UserProductivityModule } from './monitoring/user-productivity.module';
import { GatewaysModule } from './gateways/gateways.module';
// import { PublishModule } from './publish/publish.module';
import { QuestionsModule } from './questions/questions.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { FiscalModule } from './fiscal/fiscal.module';
import { LogisticsModule } from './logistics/logistics.module';
import { CustomerModule } from './customer/customer.module';
import { CheckoutModule } from './checkout/checkout.module';
import { PaymentModule } from './payment/payment.module';
import { OrderModule } from './order/order.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchModule } from './search/search.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MarketingModule } from './marketing/marketing.module';
import { ScraperModule } from './scraper/scraper.module';
import { FinancialModule } from './financial/financial.module';
import { ListingModule } from './listing/listing.module'; // Added ListingModule
import { MarketplaceOrchestratorModule } from './marketplace-orchestrator/marketplace-orchestrator.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { VehicleDiscoveryModule } from './vehicle-discovery/vehicle-discovery.module';
import { VehicleCompatibilityModule } from './vehicle-compatibility/vehicle-compatibility.module';
import { InternalModule } from './internal/internal.module';
import { GeneralProductModule } from './general-product/general-product.module';

import { ScheduleModule } from '@nestjs/schedule';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // TypeOrmModule.forRootAsync({
    //   imports: [ConfigModule],
    //   inject: [ConfigService],
    //   useFactory: (configService: ConfigService) => ({
    //     type: 'mysql',
    //     host: configService.get('DB_HOST', 'localhost'),
    //     port: configService.get('DB_PORT', 3306),
    //     username: configService.get('DB_USERNAME', 'root'),
    //     password: configService.get('DB_PASSWORD', ''),
    //     database: configService.get('DB_DATABASE', 'marketplace_integration'),
    //     entities: [__dirname + '/**/*.entity{.ts,.js}'],
    //     autoLoadEntities: true,
    //     synchronize: configService.get('DB_SYNCHRONIZE', 'false') === 'true',
    //     timezone: 'Z',
    //     dateStrings: true,
    //     extra: {
    //       timezone: 'Z',
    //       connectionLimit: 50,
    //       enableKeepAlive: true,
    //       keepAliveInitialDelay: 10000,
    //     },
    //   }),
    // }),
    ProductModule,
    MarketplaceModule,
    QueueModule,
    RabbitMqModule,
    AuthModule,
    WebhookModule,
    MonitoringModule,
    StatsModule,
    CompatibilityModule,
    CompatibilitiesModule,
    OLXModule,
    AiModule,
    NotificationsModule,
    // PublishModule,
    QuestionsModule,
    FiscalModule,
    LogisticsModule,
    OrderModule,
    CustomerModule,
    CheckoutModule,
    PaymentModule,
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    // MongoDB Connection (default — autopeças)
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    GeneralProductModule,
    // ElasticSearch Connection
    // Search Module
    SearchModule,
    AnalyticsModule,
    MarketingModule,
    MarketingModule,
    ScraperModule,
    FinancialModule,
    ListingModule,
    MarketplaceOrchestratorModule,
    UserProductivityModule,
    GatewaysModule,
    SchedulerModule,
    VehicleCompatibilityModule,
    VehicleDiscoveryModule,
    InternalModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule { }
