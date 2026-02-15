import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: QueueRecordModel.name, schema: QueueRecordSchema }]),
    ClientsModule.registerAsync([
      {
        name: 'MARKETPLACE_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672')],
            queue: configService.get<string>('MARKETPLACE_QUEUE', 'marketplace_integration'),
            queueOptions: {
              durable: true
            },
          },
        }),
      },
      {
        name: 'PRODUCT_UPDATES_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672')],
            queue: configService.get<string>('PRODUCT_UPDATES_QUEUE', 'product_updates'),
            queueOptions: {
              durable: true
            },
          },
        }),
      },
    ]),
    ScheduleModule.forRoot(),
    forwardRef(() => AuthModule), // Importando AuthModule para disponibilizar JwtService
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule { }