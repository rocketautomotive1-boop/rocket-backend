import { Module, forwardRef } from '@nestjs/common';

import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SearchModule } from '../search/search.module';

import { ProductModel, ProductSchema } from './schemas/product.schema';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from './schemas/product-compatibility.schema';
import { ProductUnitModel, ProductUnitSchema } from './schemas/product-unit.schema';
import { ProductNCMModel, ProductNCMSchema } from './schemas/product-ncm.schema';
import { ProductWarrantyModel, ProductWarrantySchema } from './schemas/product-warranty.schema';
import { ProductConditionModel, ProductConditionSchema } from './schemas/product-condition.schema';
import { ProductPublicationLogModel, ProductPublicationLogSchema } from './schemas/product-publication-log.schema';
import { BrandModel, BrandSchema } from './schemas/brand.schema';
import { CategoryModel, CategorySchema } from './schemas/category.schema';
import { CrossReferenceGroupModel, CrossReferenceGroupSchema } from './schemas/cross-reference-group.schema';
import { CrossReferenceCodeModel, CrossReferenceCodeSchema } from './schemas/cross-reference-code.schema';
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';
import { ProductDraftModel, ProductDraftSchema } from './schemas/product-draft.schema';
import { ProductDiscoveryModel, ProductDiscoverySchema } from './schemas/product-discovery.schema';
import { UserModel, UserSchema } from '../auth/schemas/user.schema';

import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';
import { ProductController } from './product.controller';
import { QueueModule } from '../queue/queue.module';
import { S3Module } from '../common/s3/s3.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { GatewaysModule } from '../gateways/gateways.module';

import { ProductBrandController } from './controllers/product-brand.controller';
import { ProductCategoryController } from './controllers/product-category.controller';
import { ProductNCMController } from './controllers/product-ncm.controller';
import { ProductUnitController } from './controllers/product-unit.controller';
import { ProductWarrantyController } from './controllers/product-warranty.controller';
import { ProductBrandService } from './services/product-brand.service';
import { ProductCategoryService } from './services/product-category.service';
import { ProductNCMService } from './services/product-ncm.service';
import { ProductUnitService } from './services/product-unit.service';
import { ProductWarrantyService } from './services/product-warranty.service';

import { ProductImageService } from './services/product-image.service';
import { ProductTitleService } from './services/product-title.service';
import { ProductTitleController } from './controllers/product-title.controller';

import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { AttributesModule } from '../marketplace/attributes/attributes.module';
import { ProductFilterService } from './services/product-filter.service';

import { ProductCompatibilityController } from './controllers/product-compatibility.controller';
import { ProductCompatibilityService } from './services/product-compatibility.service';
import { ProductCompatibilityPositionService } from './services/product-compatibility-position.service';
import { CompatibilityGroupPropagationService } from './services/compatibility-group-propagation.service';
import { ProductCompatibilityManagementController } from './controllers/product-compatibility-management.controller';
import { ProductVehicleSearchService } from './services/product-vehicle-search.service';
import { SearchResultCacheService } from './services/search-result-cache.service';
import { KnownBrandKeysCacheService } from './services/known-brand-keys-cache.service';
import { ProductSearchRankingService } from './services/product-search-ranking.service';
import { CategoryLookupService } from './services/category-lookup.service';
import { ProductRailsService } from './services/product-rails.service';
import { RelevanceScoreJob } from './jobs/relevance-score.job';
import { VehicleCompatibilityModule } from '../vehicle-compatibility/vehicle-compatibility.module';
// import { PublishModule } from '../publish/publish.module';
import { ListingModule } from '../listing/listing.module'; // Added ListingModule
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { MarketplaceOrchestratorModule } from '../marketplace-orchestrator/marketplace-orchestrator.module';
// ProductDiscoveryController removido (integrado em ProductController)

// Novos controllers
import { StoreProductController } from './store-product.controller';
import { ProductConditionController } from './controllers/product-condition.controller';
import { ProductMovementController } from './controllers/product-movement.controller';

// Novos services
import { ProductConditionService } from './services/product-condition.service';
import { ProductPublicationLogService } from './services/product-publication-log.service';
import { ProductPublicationLogController } from './controllers/product-publication-log.controller';
import { OrderEventsListener } from './listeners/order-events.listener';
import { MigrationService } from './services/migration.service';
import { MigrationController } from './controllers/migration.controller';
import { CrossReferenceController } from './controllers/cross-reference.controller';
import { KitRelationsController } from './controllers/kit-relations.controller';
import { CrossReferenceConflictsController } from './controllers/cross-reference-conflicts.controller';
import { CrossReferenceService } from './services/cross-reference.service';
import { ImportCatalogController } from './controllers/import-catalog.controller';
import { ImportCatalogService } from './services/import-catalog.service';
import { SitemapController } from './controllers/sitemap.controller';
import { CatalogMigrationService } from './services/catalog-migration.service';

import { ProductDiscoveryService } from './services/product-discovery.service';
import { CategoryResolutionService } from './services/category-resolution.service';

import { ProductAliasModel, ProductAliasSchema } from './schemas/product-alias.schema';
import { TitleCategoryHintModel, TitleCategoryHintSchema } from './schemas/title-category-hint.schema';
import { TitleCategoryHintService } from './services/title-category-hint.service';
import { ProductShortTitleModel, ProductShortTitleSchema } from './schemas/product-short-title.schema';
import { ProductShortTitleService } from './services/product-short-title.service';
import { ProductShortTitleController } from './controllers/product-short-title.controller';
import { ProductShortTitleMigrationService } from './services/product-short-title-migration.service';
import { ProductMatcherService } from './services/product-matcher.service';
import { StockSyncConsumer } from './consumers/stock-sync.consumer';
import { DiscoveryMsResponseConsumer } from './consumers/discovery-ms-response.consumer';
import { SourceRefreshService } from './services/source-refresh.service';
import { SourceRefreshResponseConsumer } from './consumers/source-refresh-response.consumer';
import { ProductReadinessService } from './services/product-readiness.service';
import { PublicationTriggerListener } from './listeners/publication-trigger.listener';
import { ContentResyncListener } from './listeners/content-resync.listener';
import { ShortTitleDiscoveryService } from './services/short-title-discovery.service';
import { ShortTitleDiscoveryListener } from './listeners/short-title-discovery.listener';
import { TitleCategoryAutoApplyListener } from './listeners/title-category-auto-apply.listener';
import { ReadinessRecoveryJob } from './jobs/readiness-recovery.job';
import { CategorySnapshotService } from './services/category-snapshot.service';

import { ProductResolverProvider } from './ports/product-resolver.provider';
import { PRODUCT_RESOLVER_PORT } from '../order/ports/product-resolver.port';
import { ProductBotQueryService } from './services/product-bot-query.service';
import { PRODUCT_INFO_QUERY_PORT } from '../notifications/bot/ports/bot-query.ports';
// STOCK_LEDGER_PORT is now owned by StockModule (single stock owner).
import { StockModule } from '../stock/stock.module';
import { PricingModule } from '../pricing/pricing.module';
import { StoreListingModule } from '../store-listing/store-listing.module';
import { ProductDeletionModule } from '../product-deletion/product-deletion.module';


@Module({
  imports: [

    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
      { name: ProductUnitModel.name, schema: ProductUnitSchema },
      { name: ProductNCMModel.name, schema: ProductNCMSchema },
      { name: ProductWarrantyModel.name, schema: ProductWarrantySchema },
      { name: ProductConditionModel.name, schema: ProductConditionSchema },
      { name: ProductPublicationLogModel.name, schema: ProductPublicationLogSchema },
      { name: BrandModel.name, schema: BrandSchema },
      { name: CategoryModel.name, schema: CategorySchema },
      { name: CrossReferenceGroupModel.name, schema: CrossReferenceGroupSchema },
      { name: CrossReferenceCodeModel.name, schema: CrossReferenceCodeSchema },
      { name: ProductAliasModel.name, schema: ProductAliasSchema },
      { name: TitleCategoryHintModel.name, schema: TitleCategoryHintSchema },
      { name: ProductShortTitleModel.name, schema: ProductShortTitleSchema },
      { name: QueueRecordModel.name, schema: QueueRecordSchema },
      { name: ProductDraftModel.name, schema: ProductDraftSchema },
      { name: ProductDiscoveryModel.name, schema: ProductDiscoverySchema },
      { name: 'MarketplaceModel', schema: require('../marketplace/schemas/marketplace.schema').MarketplaceSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
    forwardRef(() => SearchModule),
    S3Module,
    AuthModule,
    AttributesModule,
    forwardRef(() => QueueModule),

    // PublishModule,
    MarketplaceRegistryModule,
    forwardRef(() => MarketplaceModule),
    AiModule,
    ListingModule,
    StockModule,
    PricingModule,
    StoreListingModule,
    UserProductivityModule,
    forwardRef(() => MarketplaceOrchestratorModule),
    GatewaysModule,
    VehicleCompatibilityModule,
    forwardRef(() => ProductDeletionModule),
  ],
  controllers: [
    ProductController,
    StoreProductController,
    SitemapController,
    ProductBrandController,
    ProductCategoryController,
    ProductNCMController,
    ProductUnitController,
    ProductWarrantyController,

    ProductTitleController,
    ProductCompatibilityController,
    ProductCompatibilityManagementController,
    ProductConditionController,
    ProductMovementController,
    ProductPublicationLogController,
    MigrationController,
    CrossReferenceController,
    KitRelationsController,
    CrossReferenceConflictsController,
    ImportCatalogController,
    ProductShortTitleController
  ],
  providers: [
    ProductService,
    ProductRepository,
    ProductBrandService,
    ProductCategoryService,
    TitleCategoryHintService,
    ProductShortTitleService,
    ProductShortTitleMigrationService,
    ProductNCMService,
    ProductUnitService,
    ProductWarrantyService,
    ProductImageService,
    ProductTitleService,
    ProductFilterService,
    ProductCompatibilityService,
    ProductCompatibilityPositionService,
    CompatibilityGroupPropagationService,
    ProductVehicleSearchService,
    SearchResultCacheService,
    KnownBrandKeysCacheService,
    ProductSearchRankingService,
    CategoryLookupService,
    ProductRailsService,
    RelevanceScoreJob,
    ProductConditionService,
    ProductPublicationLogService,
    OrderEventsListener, // Event listener for order sync
    MigrationService,
    CrossReferenceService,
    ImportCatalogService,
    CatalogMigrationService,

    ProductMatcherService,
    StockSyncConsumer, // [NEW] RabbitMQ Consumer
    ProductDiscoveryService,
    SourceRefreshService,
    CategoryResolutionService,
    DiscoveryMsResponseConsumer,
    SourceRefreshResponseConsumer,
    ProductReadinessService,
    PublicationTriggerListener,
    ContentResyncListener,
    ShortTitleDiscoveryService,
    ShortTitleDiscoveryListener,
    TitleCategoryAutoApplyListener,
    ReadinessRecoveryJob,
    CategorySnapshotService,
    // Hexagonal port implementations consumed by OrderModule
    ProductResolverProvider,
    { provide: PRODUCT_RESOLVER_PORT, useClass: ProductResolverProvider },
    // Bot read-port consumed by NotificationsModule
    ProductBotQueryService,
    { provide: PRODUCT_INFO_QUERY_PORT, useExisting: ProductBotQueryService },
  ],
  exports: [

    ProductService,
    ProductRepository,
    ProductImageService,
    ProductTitleService,
    ProductShortTitleService,
    ProductCategoryService,
    ProductCompatibilityService,
    ProductCompatibilityPositionService,
    ProductConditionService,
    ProductPublicationLogService,
    MigrationService,
    CrossReferenceService,
    CatalogMigrationService,
    ProductMatcherService,
    ProductDiscoveryService,
    CategorySnapshotService,
    ProductVehicleSearchService,
    // Re-export Stock/Pricing so consumers of ProductModule can inject their ports
    // without each importing those modules directly.
    StockModule,
    PricingModule,
    // Tokens consumed by OrderModule
    PRODUCT_RESOLVER_PORT,
    // Token consumed by NotificationsModule (bot product search)
    PRODUCT_INFO_QUERY_PORT,
  ],
})
export class ProductModule { }
