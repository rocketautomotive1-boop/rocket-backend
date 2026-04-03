import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryGateway } from './discovery.gateway';
import { OrderGateway } from './order.gateway';
import { RembgGateway } from './rembg.gateway';
import { RembgController } from './rembg.controller';
import {
    ProcessedImage,
    ProcessedImageSchema,
} from './schemas/processed-image.schema';
import { ProcessedImageService } from './processed-image.service';

@Module({
    imports: [
        MulterModule.register({
            limits: {
                fileSize: 100 * 1024 * 1024, // 100MB
            },
        }),
        MongooseModule.forFeature([
            { name: ProcessedImage.name, schema: ProcessedImageSchema },
        ]),
    ],
    controllers: [RembgController],
    providers: [DiscoveryGateway, OrderGateway, RembgGateway, ProcessedImageService],
    exports: [DiscoveryGateway, OrderGateway, RembgGateway, ProcessedImageService],
})
export class GatewaysModule { }
