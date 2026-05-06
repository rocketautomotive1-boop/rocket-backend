import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMqModule } from '../common/rabbitmq/rabbitmq.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { AuthModule } from '../auth/auth.module';

import { ListingStatusListener } from './listing-status.listener';
import { ListingRemovalService } from './services/listing-removal.service';
import { ItemModerationService } from './services/item-moderation.service';
import { OLXReconciliationService } from './services/olx-reconciliation.service';
import { MarketplaceIssuesService } from './services/marketplace-issues.service';
import { PublicationFlowService } from './services/publication-flow.service';
import { OperationalIssuesService } from './services/operational-issues.service';
import { OrchestratorPublisherService } from './orchestrator-publisher.service';

import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';

import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { PublicationAttempt, PublicationAttemptSchema } from '../marketplace/schemas/publication-attempt.schema';
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { ProductRepository } from '../product/product.repository';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { ProductModule } from '../product/product.module';

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
        ]),
        UserProductivityModule,
    ],
    controllers: [MarketplaceOrchestratorController],
    providers: [
        PublicationLogService,
        ListingStatusListener,
        PublicationFlowService,
        ProductRepository,
        ListingRemovalService,
        ItemModerationService,
        OLXReconciliationService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        OrchestratorPublisherService,
    ],
    exports: [
        ListingRemovalService,
        ItemModerationService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        OrchestratorPublisherService,
    ],
})
export class MarketplaceOrchestratorModule { }
