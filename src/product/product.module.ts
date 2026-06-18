import { Module, forwardRef } from '@nestjs/common';

import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
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
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';
import { ProductDraftModel, ProductDraftSchema } from './schemas/product-draft.schema';
import { ProductDiscoveryModel, ProductDiscoverySchema } from './schemas/product-discovery.schema';
import { AllocationModel, AllocationSchema } from './schemas/allocation.schema';
import { WarehouseModel, WarehouseSchema } from './schemas/warehouse.schema';
import { BoxModel, BoxSchema } from './schemas/box.schema';
import { BoxItemModel, BoxItemSchema } from './schemas/box-item.schema';

import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';
import { ProductController } from './product.controller';
import { QueueModule } from '../queue/queue.module';
import { S3Module } from '../common/s3/s3.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';

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

import { ProductAllocationController } from './controllers/product-allocation.controller';
import { ProductAllocationService } from './services/product-allocation.service';

import { ProductCompatibilityController } from './controllers/product-compatibility.controller';
import { ProductCompatibilityService } from './services/product-compatibility.service';
import { ProductCompatibilityManagementController } from './controllers/product-compatibility-management.controller';
// import { PublishModule } from '../publish/publish.module';
import { ListingModule } from '../listing/listing.module'; // Added ListingModule
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { MarketplaceOrchestratorModule } from '../marketplace-orchestrator/marketplace-orchestrator.module';
// ProductDiscoveryController removido (integrado em ProductController)

// Novos controllers
import { StoreProductController } from './store-product.controller';
import { ProductConditionController } from './controllers/product-condition.controller';
import { ProductMovementController } from './controllers/product-movement.controller';
import { WarehouseController } from './controllers/warehouse.controller';
import { BoxController } from './controllers/box.controller';

// Novos services
import { ProductConditionService } from './services/product-condition.service';
import { WarehouseService } from './services/warehouse.service';
import { BoxService } from './services/box.service';
import { BoxItemService } from './services/box-item.service';
import { BoxItemController } from './controllers/box-item.controller';
import { ProductPublicationLogService } from './services/product-publication-log.service';
import { ProductPublicationLogController } from './controllers/product-publication-log.controller';
import { ProductSyncService } from './services/product-sync.service';
import { OrderEventsListener } from './listeners/order-events.listener';
import { MigrationService } from './services/migration.service';
import { MigrationController } from './controllers/migration.controller';
import { CrossReferenceController } from './controllers/cross-reference.controller';
import { CrossReferenceService } from './services/cross-reference.service';
import { SitemapController } from './controllers/sitemap.controller';
import { CatalogMigrationService } from './services/catalog-migration.service';

import { ProductDiscoveryService } from './services/product-discovery.service';
import { CategoryResolutionService } from './services/category-resolution.service';

import { ReviewModel, ReviewSchema } from './schemas/review.schema';
import { ReviewsService } from './services/reviews.service';
import { ReviewsController } from './controllers/reviews.controller';

import { ProductAliasModel, ProductAliasSchema } from './schemas/product-alias.schema';
import { ProductMatcherService } from './services/product-matcher.service';
import { StockSyncConsumer } from './consumers/stock-sync.consumer';
import { DiscoveryMsResponseConsumer } from './consumers/discovery-ms-response.consumer';
import { SourceRefreshService } from './services/source-refresh.service';
import { SourceRefreshResponseConsumer } from './consumers/source-refresh-response.consumer';
import { ProductReadinessService } from './services/product-readiness.service';
import { PublicationTriggerListener } from './listeners/publication-trigger.listener';
import { ReadinessRecoveryJob } from './jobs/readiness-recovery.job';
import { CategorySnapshotService } from './services/category-snapshot.service';

import { ProductResolverProvider } from './ports/product-resolver.provider';
import { PRODUCT_RESOLVER_PORT } from '../order/ports/product-resolver.port';
// STOCK_LEDGER_PORT is now owned by StockModule (single stock owner).
import { StockModule } from '../stock/stock.module';
import { PricingModule } from '../pricing/pricing.module';


@Module({
  imports: [

    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: ReviewModel.name, schema: ReviewSchema },
      { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
      { name: ProductUnitModel.name, schema: ProductUnitSchema },
      { name: ProductNCMModel.name, schema: ProductNCMSchema },
      { name: ProductWarrantyModel.name, schema: ProductWarrantySchema },
      { name: ProductConditionModel.name, schema: ProductConditionSchema },
      { name: ProductPublicationLogModel.name, schema: ProductPublicationLogSchema },
      { name: BrandModel.name, schema: BrandSchema },
      { name: CategoryModel.name, schema: CategorySchema },
      { name: CrossReferenceGroupModel.name, schema: CrossReferenceGroupSchema },
      { name: ProductAliasModel.name, schema: ProductAliasSchema },
      { name: QueueRecordModel.name, schema: QueueRecordSchema },
      { name: ProductDraftModel.name, schema: ProductDraftSchema },
      { name: ProductDiscoveryModel.name, schema: ProductDiscoverySchema },
      { name: AllocationModel.name, schema: AllocationSchema },
      { name: WarehouseModel.name, schema: WarehouseSchema },
      // { name: BoxModel.name, schema: BoxSchema }, // Agora é sub-documento de Allocation
      { name: BoxItemModel.name, schema: BoxItemSchema },
      { name: 'MarketplaceModel', schema: require('../marketplace/schemas/marketplace.schema').MarketplaceSchema },
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
    UserProductivityModule,
    forwardRef(() => MarketplaceOrchestratorModule),
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
    ReviewsController,

    ProductAllocationController,
    ProductTitleController,
    ProductCompatibilityController,
    ProductCompatibilityManagementController,
    ProductConditionController,
    ProductMovementController,
    WarehouseController,
    BoxController,
    BoxItemController,
    ProductPublicationLogController,
    MigrationController,
    CrossReferenceController
  ],
  providers: [
    ProductService,
    ProductRepository,
    ReviewsService,
    ProductBrandService,
    ProductCategoryService,
    ProductNCMService,
    ProductUnitService,
    ProductWarrantyService,
    ProductAllocationService,
    ProductImageService,
    ProductTitleService,
    ProductFilterService,
    ProductCompatibilityService,
    ProductConditionService,
    WarehouseService,
    BoxService,
    BoxItemService,
    ProductPublicationLogService,
    ProductSyncService,
    OrderEventsListener, // Event listener for order sync
    MigrationService,
    CrossReferenceService,
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
    ReadinessRecoveryJob,
    CategorySnapshotService,
    // Hexagonal port implementations consumed by OrderModule
    ProductResolverProvider,
    { provide: PRODUCT_RESOLVER_PORT, useClass: ProductResolverProvider },
  ],
  exports: [

    ProductService,
    ProductRepository,
    ReviewsService,
    ProductAllocationService,
    ProductImageService,
    ProductTitleService,
    ProductCategoryService,
    ProductCompatibilityService,
    ProductConditionService,
    WarehouseService,
    BoxService,
    BoxItemService,
    ProductPublicationLogService,
    ProductSyncService,
    MigrationService,
    CrossReferenceService,
    CatalogMigrationService,
    ProductMatcherService,
    ProductDiscoveryService,
    // Re-export Stock/Pricing so consumers of ProductModule can inject their ports
    // without each importing those modules directly.
    StockModule,
    PricingModule,
    // Tokens consumed by OrderModule
    PRODUCT_RESOLVER_PORT,
  ],
})
export class ProductModule { }
