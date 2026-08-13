import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMqModule } from '../common/rabbitmq/rabbitmq.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { AuthModule } from '../auth/auth.module';

import { ListingRemovalService } from './services/listing-removal.service';
import { OLXReconciliationService } from './services/olx-reconciliation.service';
import { MarketplaceIssuesService } from './services/marketplace-issues.service';
import { PublicationFlowService } from './services/publication-flow.service';
import { OperationalIssuesService } from './services/operational-issues.service';
import { OutboxModule } from '../outbox/outbox.module';

import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../stock/schemas/stock-movement.schema';

import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { PublicationAttempt, PublicationAttemptSchema } from '../marketplace/schemas/publication-attempt.schema';
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { ProductRepository } from '../product/product.repository';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { ProductModule } from '../product/product.module';
import { GatewaysModule } from '../gateways/gateways.module';
import { SyncResultConsumer } from './sync-result.consumer';
import { ModerationModule } from '../moderation/moderation.module';
import { ModerationRemovalWorker } from './workers/moderation-removal.worker';
import { ListingModule } from '../listing/listing.module';

/**
 * Backend half of the marketplace-sync contract. This module is NOT the orchestrator itself —
 * publication execution lives in `microservices/orchestrator` (RabbitMQ-only, no HTTP). This
 * module owns the pieces the backend must keep because it owns the data and the HTTP surface:
 *
 *  - OrchestratorPublisherService  → publishes `product.sync.requested` (outbound contract).
 *  - SyncResultConsumer            → consumes `rocket.marketplace.results`, writes ListingModel
 *                                    + emits websocket. The data owner writes the data
 *                                    (no shared-DB-write from the microservice).
 *  - MarketplaceOrchestratorController + PublicationFlow/MarketplaceIssues/OperationalIssues
 *                                    → HTTP APIs (/marketplace-orchestrator/*) consumed by the
 *                                    mobile app; the microservice exposes no HTTP equivalent.
 *  - OLXReconciliationService      → backend-only cron reconciling OLX imports in ListingModel.
 *  - ListingRemovalService         → listing removal (used by product-title controller).
 *
 * Moderation (infractions/wrong-category/removal) lives entirely in `microservices/moderations`.
 * The route prefix `/marketplace-orchestrator` is intentionally kept stable (frontend depends on it).
 */
@Module({
    imports: [
        RabbitMqModule,
        MarketplaceAuthModule,
        AuthModule,
        forwardRef(() => ProductModule),
        MongooseModule.forFeature([
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: PublicationAttempt.name, schema: PublicationAttemptSchema },
            { name: CategoryModel.name, schema: CategorySchema },
            { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
            { name: ProductModel.name, schema: ProductSchema },
            { name: StockMovementModel.name, schema: StockMovementSchema },
        ]),
        UserProductivityModule,
        GatewaysModule,
        OutboxModule,
        ModerationModule,
        ListingModule,
    ],
    controllers: [MarketplaceOrchestratorController],
    providers: [
        PublicationLogService,
        PublicationFlowService,
        ProductRepository,
        ListingRemovalService,
        OLXReconciliationService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        SyncResultConsumer,
        ModerationRemovalWorker,
    ],
    exports: [
        ListingRemovalService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        OutboxModule,
    ],
})
export class MarketplaceOrchestratorModule { }
