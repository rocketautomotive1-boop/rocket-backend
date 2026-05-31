import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModel, MarketplaceSchema } from '../schemas/marketplace.schema';
import { MarketplaceAccountModel, MarketplaceAccountSchema } from './schemas/marketplace-account.schema';
import { MarketplaceAccountRepository } from './services/marketplace-account.repository';
import { MarketplaceAccountService } from './services/marketplace-account.service';
import { MarketplaceAuthService } from './services/marketplace-auth.service';
import { TokenManagerService } from './services/token-manager.service';

import { MarketplaceRegistryModule } from '../marketplace-registry.module';
import { MarketplaceModule } from '../marketplace.module';
import { AmazonAuthAdapter } from '../adapters/amazon/amazon-auth.adapter';
import { ShopeeAuthAdapter } from '../adapters/shopee/shopee-auth.adapter';
import { MercadoLivreAuthAdapter } from '../adapters/mercado-livre/mercado-livre-auth.adapter';
import { OLXAuthService } from '../adapters/olx/olx-auth.service';
import { MagaluAuthAdapter } from '../adapters/magalu/magalu-auth.adapter';
import { ViaVarejoAuthAdapter } from '../adapters/viavarejo/viavarejo-auth.adapter';
import { YampiAuthAdapter } from '../adapters/yampi/yampi-auth.adapter';


import { HttpModule } from '@nestjs/axios';

import { MarketplaceAccountAuthController } from './controllers/marketplace-account-auth.controller';
import { MarketplaceAuthController } from './controllers/marketplace-auth.controller';
import { MarketplaceCallbackController } from './controllers/marketplace-callback.controller';

@Module({
    imports: [
        HttpModule,
        ConfigModule,

        MongooseModule.forFeature([
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: MarketplaceAccountModel.name, schema: MarketplaceAccountSchema },
        ]),
        forwardRef(() => MarketplaceRegistryModule),
        forwardRef(() => MarketplaceModule),
    ],
    controllers: [
        MarketplaceAuthController,
        MarketplaceCallbackController,
        MarketplaceAccountAuthController
    ],
    providers: [
        MarketplaceAuthService,
        TokenManagerService,
        MarketplaceAccountRepository,
        MarketplaceAccountService,
        AmazonAuthAdapter,
        ShopeeAuthAdapter,
        MercadoLivreAuthAdapter,
        OLXAuthService,
        MagaluAuthAdapter,
        ViaVarejoAuthAdapter,
        YampiAuthAdapter,
    ],
    exports: [
        MarketplaceAuthService,
        TokenManagerService,
        MarketplaceAccountRepository,
        MarketplaceAccountService,
        AmazonAuthAdapter,
        ShopeeAuthAdapter,
        MercadoLivreAuthAdapter,
        OLXAuthService,
        MagaluAuthAdapter,
        ViaVarejoAuthAdapter,
        YampiAuthAdapter,
    ],

})
export class MarketplaceAuthModule { }
