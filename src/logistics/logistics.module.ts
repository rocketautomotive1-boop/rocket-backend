import { Module } from '@nestjs/common';

import { HttpModule } from '@nestjs/axios';
import { LogisticsController } from './logistics.controller';
import { PickingService } from './services/picking.service';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductDocument } from '../product/product-types';
import { BoxItem } from '../product/product-types';
import { FreightService } from './freight/freight.service';
import { FedExProvider } from './freight/providers/fedex/fedex.provider';
import { JamefProvider } from './freight/providers/jamef/jamef.provider';
import { TokenManagerService } from './freight/token/token-manager.service';

import { AzulCargoProvider } from './freight/providers/azul/azul-cargo.provider';
import { CorreiosProvider } from './freight/providers/correios/correios.provider';
import { UberProvider } from './freight/providers/uber/uber.provider';

import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: ProductModel.name, schema: ProductSchema }]),
        MarketplaceModule,
        HttpModule,
    ],
    controllers: [LogisticsController],
    providers: [
        PickingService,
        FreightService,
        FedExProvider,
        JamefProvider,
        AzulCargoProvider,
        CorreiosProvider,
        UberProvider,
        TokenManagerService,
    ],
    exports: [FreightService],
})
export class LogisticsModule { }
