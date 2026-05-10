import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryGateway } from './discovery.gateway';
import { OrderGateway } from './order.gateway';
import { RembgGateway } from './rembg.gateway';
import { SyncGateway } from './sync.gateway';
import { RembgController } from './rembg.controller';
import { ProcessedImage, ProcessedImageSchema } from './schemas/processed-image.schema';
import { ProcessedImageService } from './processed-image.service';
import { RembgJob, RembgJobSchema } from './schemas/rembg-job.schema';
import { RembgEnqueueService } from './rembg-enqueue.service';
import { RembgJobConsumer } from './rembg-job.consumer';
import { S3Module } from '../common/s3/s3.module';
import { AuthModule } from '../auth/auth.module';
import { ProductDiscoveryModel, ProductDiscoverySchema } from '../product/schemas/product-discovery.schema';

@Module({
    imports: [
        MulterModule.register({
            limits: {
                fileSize: 100 * 1024 * 1024, // 100MB
            },
        }),
        MongooseModule.forFeature([
            { name: ProcessedImage.name, schema: ProcessedImageSchema },
            { name: RembgJob.name, schema: RembgJobSchema },
            { name: ProductDiscoveryModel.name, schema: ProductDiscoverySchema },
        ]),
        S3Module,
        AuthModule,
    ],
    controllers: [RembgController],
    providers: [
        DiscoveryGateway,
        OrderGateway,
        RembgGateway,
        SyncGateway,
        ProcessedImageService,
        RembgEnqueueService,
        RembgJobConsumer,
    ],
    exports: [DiscoveryGateway, OrderGateway, RembgGateway, SyncGateway, ProcessedImageService, RembgEnqueueService],
})
export class GatewaysModule { }
