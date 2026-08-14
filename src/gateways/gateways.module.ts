import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryGateway } from './discovery.gateway';
import { OrderGateway } from './order.gateway';
import { RembgGateway } from './rembg.gateway';
import { SyncGateway } from './sync.gateway';
import { RembgController } from './rembg.controller';
import { RembgJob, RembgJobSchema } from './schemas/rembg-job.schema';
import { RembgEnqueueService } from './rembg-enqueue.service';
import { RembgCompletionService } from './rembg-completion.service';
import { RembgDispatchWorker } from './rembg-dispatch.worker';
import { RembgReconciler } from './rembg-reconciler.service';
import { S3Module } from '../common/s3/s3.module';
import { AuthModule } from '../auth/auth.module';
import { ProcessedImageModule } from '../processed-image/processed-image.module';
import { ProductDiscoveryModel, ProductDiscoverySchema } from '../product/schemas/product-discovery.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';

@Module({
    imports: [
        ConfigModule,
        MulterModule.register({
            limits: {
                fileSize: 100 * 1024 * 1024, // 100MB
            },
        }),
        MongooseModule.forFeature([
            { name: RembgJob.name, schema: RembgJobSchema },
            { name: ProductDiscoveryModel.name, schema: ProductDiscoverySchema },
            { name: ProductModel.name, schema: ProductSchema },
        ]),
        S3Module,
        AuthModule,
        ProcessedImageModule,
    ],
    controllers: [RembgController],
    providers: [
        DiscoveryGateway,
        OrderGateway,
        RembgGateway,
        SyncGateway,
        RembgEnqueueService,
        RembgCompletionService,
        RembgDispatchWorker,
        RembgReconciler,
    ],
    exports: [
        DiscoveryGateway,
        OrderGateway,
        RembgGateway,
        SyncGateway,
        ProcessedImageModule,
        RembgEnqueueService,
        RembgCompletionService,
    ],
})
export class GatewaysModule { }
