import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMqModule } from '../common/rabbitmq/rabbitmq.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { AuthModule } from '../auth/auth.module';

import { MarketplaceOrchestratorService } from './marketplace-orchestrator.service';
import { ListingStatusListener } from './listing-status.listener';
import { ShopeeSyncWorker } from './workers/shopee-sync.worker';
import { PublicationContextService } from './services/publication-context.service';
import { MarketplaceResilienceService } from './services/marketplace-resilience.service';
import { SyncQueueService } from './services/sync-queue.service';
import { SyncQueueWorker } from './workers/sync-queue.worker';
import { ListingRemovalService } from './services/listing-removal.service';
import { PayloadBuilderService } from './services/payload-builder.service';
import { ItemModerationService } from './services/item-moderation.service';

import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { StockMovementModel, StockMovementSchema } from '../product/schemas/stock-movement.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { WatcherToken, WatcherTokenSchema } from './schemas/watcher-token.schema';
import { SyncRequest, SyncRequestSchema } from './schemas/sync-request.schema';
import { GlobalWatcherService } from './global-watcher.service';

import { MercadoLivreSyncWorker } from './workers/mercadolivre-sync.worker';
import { AmazonSyncWorker } from './workers/amazon-sync.worker';
import { TikTokShopSyncWorker } from './workers/tiktokshop-sync.worker';
import { OLXSyncWorker } from './workers/olx-sync.worker';
import { ProductAliasModel, ProductAliasSchema } from '../product/schemas/product-alias.schema';
import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { PublicationAttempt, PublicationAttemptSchema } from '../marketplace/schemas/publication-attempt.schema';
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { ProductRepository } from '../product/product.repository';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceTemplateRepository } from '../marketplace/services/marketplace-template.repository';
import { ProductFieldMapper } from '../marketplace/services/product-field-mapper.service';
import { TemplateEngine } from '../marketplace/services/template-engine.service';
import { TemplateConditionEvaluator } from '../marketplace/services/template-condition.evaluator';
import { ProductModule } from '../product/product.module';

@Module({
    imports: [
        RabbitMqModule,
        MarketplaceAuthModule,
        AuthModule,
        forwardRef(() => ProductModule),
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: WatcherToken.name, schema: WatcherTokenSchema },
            { name: SyncRequest.name, schema: SyncRequestSchema },
            { name: PublicationAttempt.name, schema: PublicationAttemptSchema },
            { name: CategoryModel.name, schema: CategorySchema },
            { name: StockMovementModel.name, schema: StockMovementSchema },
            { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
            { name: ProductAliasModel.name, schema: ProductAliasSchema },
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
        ProductRepository,
        MercadoLivreSyncWorker,
        AmazonSyncWorker,
        TikTokShopSyncWorker,
        OLXSyncWorker,
        GlobalWatcherService,
        SyncQueueService,
        SyncQueueWorker,
        // Template engine providers
        TemplateConditionEvaluator,
        ProductFieldMapper,
        TemplateEngine,
        MarketplaceTemplateRepository,
        MarketplaceDescriptionService,
        ListingRemovalService,
        PayloadBuilderService,
        ItemModerationService,
    ],
    exports: [
        MarketplaceOrchestratorService,
        SyncQueueService,
        ListingRemovalService,
        ItemModerationService,
    ],
})
export class MarketplaceOrchestratorModule { }
