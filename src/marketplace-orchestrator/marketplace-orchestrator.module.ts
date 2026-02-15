import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMqModule } from '../common/rabbitmq/rabbitmq.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';

import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';
import { ListingStatusListener } from './listing-status.listener';
import { ShopeeSyncWorker } from './workers/shopee-sync.worker'; // Import Worker
import { PublicationContextService } from './services/publication-context.service';
import { MarketplaceResilienceService } from './services/marketplace-resilience.service';

import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { WatcherToken, WatcherTokenSchema } from './schemas/watcher-token.schema';
import { GlobalWatcherService } from './global-watcher.service';

import { MercadoLivreSyncWorker } from './workers/mercadolivre-sync.worker';
import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { PublicationAttempt, PublicationAttemptSchema } from '../marketplace/schemas/publication-attempt.schema';
import { UserProductivityModule } from '../monitoring/user-productivity.module';

@Module({
    imports: [
        RabbitMqModule,
        MarketplaceAuthModule,
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: WatcherToken.name, schema: WatcherTokenSchema },
            { name: PublicationAttempt.name, schema: PublicationAttemptSchema },
            { name: CategoryModel.name, schema: CategorySchema },
        ]),
        UserProductivityModule,
    ],
    controllers: [MarketplaceOrchestratorController],
    providers: [
        MarketplaceOrchestratorService,
        PublicationContextService,
        MarketplaceResilienceService,
        PublicationLogService,
        ListingStatusListener,
        ShopeeSyncWorker,

        MercadoLivreSyncWorker,
        GlobalWatcherService,
    ],
    exports: [
        MarketplaceOrchestratorService
    ],
})
export class MarketplaceOrchestratorModule { }
