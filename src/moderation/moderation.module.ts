import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ModerationStateModel, ModerationStateSchema } from './schemas/moderation-state.schema';
import { ModerationRepository } from './moderation.repository';
import { MercadoLivreModerationProvider } from './providers/mercadolivre-moderation.provider';
import { MlModerationsClient } from './ml/ml-moderations.client';
import { WrongCategoryHandler } from './handlers/wrong-category.handler';
import { MissingCompatibilityHandler } from './handlers/missing-compatibility.handler';
import { ModerationHandlerRegistry } from './handlers/moderation-handler.registry';
import { ModerationIngestService } from './ingest/moderation-ingest.service';
import { ModerationReconciler } from './reconcile/moderation-reconciler.service';
import { ModerationWebhookListener } from './webhook/moderation-webhook.listener';

/**
 * Owns post-publication moderation, absorbed from the deleted moderations microservice.
 *
 * Dependencies are intentionally narrow to avoid module cycles (CLAUDE.md):
 *  - OutboxModule           → OrchestratorPublisherService (transactional command emit).
 *  - MarketplaceAuthModule  → MarketplaceTokenBrokerService (live token, multi-account).
 *  - MarketplaceRegistryService → injected from the @Global MarketplaceRegistryModule.
 *  - EventEmitter2 (global) → notifications + webhook trigger. No heavy module imports,
 *    no forwardRef.
 *
 * The reconciler is the source of truth (/infractions polling); the webhook listener is a
 * low-latency probe. Both feed the single ModerationIngestService.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModerationStateModel.name, schema: ModerationStateSchema },
      { name: ListingModel.name, schema: ListingSchema },
      { name: ProductModel.name, schema: ProductSchema },
    ]),
    MarketplaceAuthModule,
    OutboxModule,
  ],
  providers: [
    ModerationRepository,
    MercadoLivreModerationProvider,
    MlModerationsClient,
    WrongCategoryHandler,
    MissingCompatibilityHandler,
    ModerationHandlerRegistry,
    ModerationIngestService,
    ModerationReconciler,
    ModerationWebhookListener,
  ],
  exports: [ModerationRepository, ModerationIngestService],
})
export class ModerationModule {}
