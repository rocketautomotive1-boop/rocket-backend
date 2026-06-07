import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MarketplaceController } from './controllers/marketplace.controller';
import { MarketplaceService } from './services/marketplace.service';
import { MercadoLivreAdapter } from './adapters/mercado-livre/mercado-livre.adapter';
import { ShopeeAdapter } from './adapters/shopee/shopee.adapter';
import { CategoryController } from './controllers/category.controller';
import { CategoryService } from './services/category.service';
import { ProductModule } from '../product/product.module';
import { AuthModule } from '../auth/auth.module';
import { ListingModule } from '../listing/listing.module'; // [NEW]
import { AiModule } from '../ai/ai.module';
import { MercadoLivreProductAdapter } from './adapters/mercado-livre/mercado-livre-product.adapter';
import { MercadoLivrePricingAdapter } from './adapters/mercado-livre/mercado-livre-pricing.adapter';
import { MercadoLivreController } from './controllers/mercado-livre.controller';
import { PublicationLogService } from './services/publication-log.service';

import { MercadoLivreOrderAdapter } from './adapters/mercado-livre/mercado-livre-order.adapter';
import { MercadoLivreCategoryAdapter } from './adapters/mercado-livre/mercado-livre-category.adapter';
import { ShopeeAuthAdapter } from './adapters/shopee/shopee-auth.adapter';
import { ShopeeProductAdapter } from './adapters/shopee/shopee-product.adapter';
import { ShopeeOrderAdapter } from './adapters/shopee/shopee-order.adapter';
import { ShopeeCategoryAdapter } from './adapters/shopee/shopee-category.adapter';
import { CategoryQueryService, CategorySyncService, CategoryMappingService } from './services/category';
import { MarketplaceIntegrationService } from './services/marketplace-integration.service';
import { MarketplaceIntegrationHelperService } from './services/marketplace-integration-helper.service';
import { MarketplaceIntegrationResultService } from './services/marketplace-integration-result.service';
import { MarketplaceDescriptionService } from './services/marketplace-description.service';
import { MarketplaceTemplateRepository } from './services/marketplace-template.repository';
import { ProductFieldMapper } from './services/product-field-mapper.service';
import { TemplateEngine } from './services/template-engine.service';
import { TemplateConditionEvaluator } from './services/template-condition.evaluator';
import { MarketplaceAdapterRegistry } from './registries/marketplace-adapter.registry';
import { MarketplaceCategoryService } from './services/marketplace-category.service';

import { MarketplaceRegistryService } from './services/marketplace-registry.service';
import { MarketplaceOrderService } from './services/marketplace-order.service';
import { MercadoLivreService } from './services/mercado-livre.service';
import { ShopeeService } from './services/shopee.service';
import { CategoryAttributesService } from './services/category-attributes.service';
import { CategorySuggestionService } from './services/category-suggestion.service';
import { ProductAttributesService } from './services/product-attributes.service';
import { MercadoLivreAttributesService } from './services/mercado-livre-attributes.service';
import { MlDimensionsCalculatorService } from './services/ml-dimensions-calculator.service';
import { MlDimensionsAttributeHandler } from './listeners/ml-dimensions-attribute.handler';
import { AttributesModule } from './attributes/attributes.module';
import { MlAttributeHydrationService } from './services/ml-attribute-hydration.service';
import { MercadoLivreListingAdapter } from './adapters/mercado-livre/mercado-livre-listing.adapter';
import { MercadoLivreCompatibilityAdapter } from './adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { OLXProductAdapter } from './adapters/olx/olx-product.adapter';
import { OLXImportService } from './adapters/olx/olx-import.service';
import { OLXCatalogService } from './adapters/olx/olx-catalog.service';
import { OLXHighlightsService } from './adapters/olx/olx-highlights.service';
import { OLXWebhookService } from './adapters/olx/olx-webhook.service';
import { ViaVarejoModule } from './adapters/viavarejo/viavarejo.module';

import { YampiModule } from './adapters/yampi/yampi.module';
import { MagaluModule } from './adapters/magalu/magalu.module';

import { ShopeeController } from './controllers/shopee.controller';
import { AmazonAdapter } from './adapters/amazon/amazon.adapter';
import { AmazonService } from './services/amazon.service';
import { AmazonProductAdapter } from './adapters/amazon/amazon-product.adapter';

import { QueueModule } from '../queue/queue.module';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';
import { MarketplaceModel, MarketplaceSchema } from './schemas/marketplace.schema';
import { IgnoredOrderModel, IgnoredOrderSchema } from './schemas/ignored-order.schema';
import { MarketplaceCategoryModel, MarketplaceCategorySchema } from './schemas/marketplace-category.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../product/schemas/stock-movement.schema';
import { MarketplaceRegistryModule } from './marketplace-registry.module';
import { MarketplaceAuthModule } from './auth/marketplace-auth.module';
import { SearchModule } from '../search/search.module';
import { RocketProductAdapter } from './adapters/rocket/rocket-product.adapter';
import { MarketplaceOrchestratorModule } from '../marketplace-orchestrator/marketplace-orchestrator.module';

import { TikTokShopAdapter } from './adapters/tiktok-shop/tiktok-shop.adapter';
import { TikTokShopAuthAdapter } from './adapters/tiktok-shop/tiktok-shop-auth.adapter';
import { TikTokShopProductAdapter } from './adapters/tiktok-shop/tiktok-shop-product.adapter';
import { TikTokShopOrderAdapter } from './adapters/tiktok-shop/tiktok-shop-order.adapter';
import { TikTokShopCategoryAdapter } from './adapters/tiktok-shop/tiktok-shop-category.adapter';
import { TikTokShopService } from './services/tiktok-shop.service';
import { TikTokShopController } from './controllers/tiktok-shop.controller';

import { MarketplaceOrderGatewayProvider } from './ports/marketplace-order-gateway.provider';
import { MARKETPLACE_ORDER_GATEWAY } from '../order/ports/marketplace-order.gateway';

@Module({
  imports: [
    HttpModule,
    ClientsModule.registerAsync([
      {
        name: 'MARKETPLACE_SERVICE',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
            queue: process.env.MARKETPLACE_QUEUE || 'marketplace_integration',
            queueOptions: {
              durable: true,
            },
          },
        }),
      },
    ]),
    forwardRef(() => ProductModule),
    forwardRef(() => AuthModule),
    forwardRef(() => AiModule),
    ViaVarejoModule,
    YampiModule,
    MagaluModule,
    forwardRef(() => QueueModule),
    ListingModule,
    MongooseModule.forFeature([
      { name: MarketplaceModel.name, schema: MarketplaceSchema },
      { name: IgnoredOrderModel.name, schema: IgnoredOrderSchema },
      { name: MarketplaceCategoryModel.name, schema: MarketplaceCategorySchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StockMovementModel.name, schema: StockMovementSchema },
      { name: QueueRecordModel.name, schema: QueueRecordSchema },
      { name: require('../order/schemas/order.schema').OrderModel.name, schema: require('../order/schemas/order.schema').OrderSchema },
      {
        name: 'PublicationAttempt',
        schema: require('./schemas/publication-attempt.schema').PublicationAttemptSchema
      },
    ]),
    MarketplaceRegistryModule,
    MarketplaceAuthModule,
    forwardRef(() => SearchModule),
    forwardRef(() => MarketplaceOrchestratorModule),
  ],
  controllers: [MarketplaceController, MercadoLivreController, CategoryController, ShopeeController, TikTokShopController],

  providers: [
    MarketplaceService,
    CategoryService,
    CategoryQueryService,
    CategorySyncService,
    CategoryMappingService,
    CategoryAttributesService,
    CategorySuggestionService,
    MercadoLivreAdapter,
    ShopeeAdapter,
    MercadoLivreProductAdapter,
    MercadoLivrePricingAdapter,
    MercadoLivreOrderAdapter,
    MercadoLivreCategoryAdapter,
    MercadoLivreListingAdapter,
    MercadoLivreCompatibilityAdapter,
    MarketplaceIntegrationService,
    MarketplaceIntegrationHelperService,
    MarketplaceIntegrationResultService,
    TemplateConditionEvaluator,
    ProductFieldMapper,
    TemplateEngine,
    MarketplaceTemplateRepository,
    MarketplaceDescriptionService,
    MarketplaceOrderService,
    PublicationLogService,
    MarketplaceCategoryService,
    MercadoLivreService,
    MercadoLivreAttributesService,
    ShopeeService,
    ShopeeAuthAdapter,
    ShopeeProductAdapter,
    ShopeeOrderAdapter,
    ShopeeCategoryAdapter,
    AmazonAdapter,
    AmazonService,
    AmazonProductAdapter,
    ProductAttributesService,
    OLXProductAdapter,
    OLXImportService,
    OLXCatalogService,
    OLXHighlightsService,
    OLXWebhookService,
    MarketplaceAdapterRegistry,
    RocketProductAdapter,
    TikTokShopAdapter,
    TikTokShopAuthAdapter,
    TikTokShopProductAdapter,
    TikTokShopOrderAdapter,
    TikTokShopCategoryAdapter,
    TikTokShopService,
    MlDimensionsCalculatorService,
    MlDimensionsAttributeHandler,
    MlAttributeHydrationService,
    // Hexagonal port implementation consumed by OrderModule (pure — no Order DB access)
    MarketplaceOrderGatewayProvider,
    { provide: MARKETPLACE_ORDER_GATEWAY, useClass: MarketplaceOrderGatewayProvider },
  ],
  exports: [
    MarketplaceService,
    CategoryService,
    CategoryQueryService,
    CategorySyncService,
    CategoryMappingService,
    CategoryAttributesService,
    MarketplaceOrderService,
    CategorySuggestionService,
    MercadoLivreAdapter,
    MercadoLivreCategoryAdapter,
    MercadoLivreCompatibilityAdapter,
    ShopeeAdapter,
    MarketplaceIntegrationService,
    MarketplaceIntegrationHelperService,
    MarketplaceTemplateRepository,
    ProductFieldMapper,
    TemplateEngine,
    TemplateConditionEvaluator,
    MarketplaceDescriptionService,
    MarketplaceCategoryService,
    MarketplaceOrderService,
    MercadoLivreService,
    MercadoLivreAttributesService,
    ShopeeService,
    AmazonAdapter,
    AmazonService,
    AmazonProductAdapter,
    ProductAttributesService,
    OLXProductAdapter,
    OLXImportService,
    OLXCatalogService,
    OLXHighlightsService,
    OLXWebhookService,
    MarketplaceRegistryModule,
    MarketplaceAuthModule,
    RocketProductAdapter,
    PublicationLogService,
    TikTokShopAdapter,
    TikTokShopAuthAdapter,
    TikTokShopProductAdapter,
    TikTokShopOrderAdapter,
    TikTokShopCategoryAdapter,
    TikTokShopService,
    MlAttributeHydrationService,
    // Token consumed by OrderModule
    MARKETPLACE_ORDER_GATEWAY,
  ],
})
export class MarketplaceModule { }