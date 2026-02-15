import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DiscoveryGateway } from './discovery.gateway';
import { RembgGateway } from './rembg.gateway';
import { RembgController } from './rembg.controller';

@Module({
    imports: [
        MulterModule.register({
            limits: {
                fileSize: 100 * 1024 * 1024, // 100MB
            },
        }),
    ],
    controllers: [RembgController],
    providers: [DiscoveryGateway, RembgGateway],
    exports: [DiscoveryGateway, RembgGateway],
})
export class GatewaysModule { }
