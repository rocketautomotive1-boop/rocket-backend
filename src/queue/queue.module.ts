import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { HttpModule } from '@nestjs/axios';
import { QueueService } from './queue.service';
import { QueueCleanupScheduler } from './queue-cleanup.scheduler';
import { QueueController } from './queue.controller';
import { QueueRecordModel, QueueRecordSchema } from './schemas/queue-record.schema';
// ProductProcessor removed
// OrderProcessor removed — orders-sync queue aposentada (ingest direto + OrderReconciler)
import { CompatibilityProcessor } from './processors/compatibility.processor';


import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [

    MongooseModule.forFeature([{ name: QueueRecordModel.name, schema: QueueRecordSchema }]),
    HttpModule,
    forwardRef(() => MarketplaceModule),
    forwardRef(() => ProductModule),
    ClientsModule.registerAsync([
      {
        name: 'MARKETPLACE_SERVICE',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672'],
            queue: 'marketplace_queue',
            queueOptions: {
              durable: true
            },
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'PRODUCT_SERVICE',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL') || 'amqp://localhost:5672'],
            queue: 'product_queue',
            queueOptions: {
              durable: true
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [QueueController, CompatibilityProcessor],
  providers: [QueueService, QueueCleanupScheduler],
  exports: [QueueService, MongooseModule],
})
export class QueueModule { }
