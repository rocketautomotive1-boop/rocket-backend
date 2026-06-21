import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { HealthController } from './health.controller';
import { S3HealthIndicator } from './indicators/s3.health';
import { S3Module } from '../common/s3/s3.module';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';

@Module({
  imports: [
    TerminusModule,
    HttpModule,
    S3Module,
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
  controllers: [MonitoringController, HealthController],
  providers: [MonitoringService, S3HealthIndicator],
  exports: [MonitoringService],
})
export class MonitoringModule { }