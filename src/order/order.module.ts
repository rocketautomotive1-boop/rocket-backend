import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderLabelService } from './services/order-label.service';
import { OrderMessagingService } from './services/order-messaging.service';
import { OrderMarketplaceDetailsService } from './services/order-marketplace-details.service';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { QueueModule } from '../queue/queue.module';
import { OrderRepository } from './order.repository';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from './schemas/order.schema';
import { OrderProcessingService } from './services/order-processing.service';
import { OrderOrchestrator } from './services/order-orchestrator.service';
import { OrderSyncController } from './controllers/order-sync.controller';
import { OrderSyncProcessor } from './processors/order-sync.processor';
import { OrderMapperService } from './services/order-mapper.service';
import { StockOrchestratorService } from './services/stock-orchestrator.service';
import { OrderSyncPipeline } from './pipeline/order-sync.pipeline';
import { OrderRectifyService } from './services/order-rectify.service';

// Pricing imports
import { OrderPricingService } from './services/order-pricing.service';
import { PricingCalculatorRegistry } from './registries/pricing-calculator.registry';
import { GenericPricingCalculator } from './strategies/generic-pricing.calculator';
import { MercadoLivrePricingCalculator } from './strategies/mercadolivre-pricing.calculator';
import { OrderPricingListener } from './listeners/order-pricing.listener';
import { OrderFinancialSummaryService } from './services/order-financial-summary.service';
import { OrderCancellationService } from './services/order-cancellation.service';
import { OrderSyncFlowService } from './services/order-sync-flow.service';

// Test controller
import { OrderTestController } from './controllers/order-test.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: OrderModel.name, schema: OrderSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: ProductModel.name, schema: ProductSchema },
        ]),
        forwardRef(() => MarketplaceModule),
        forwardRef(() => ProductModule),
        forwardRef(() => FiscalModule),
        forwardRef(() => QueueModule),
    ],
    controllers: [OrderController, OrderSyncController, OrderTestController],
    providers: [
        OrderService,
        OrderRepository,
        OrderProcessingService,
        OrderOrchestrator,
        OrderMapperService,
        StockOrchestratorService,
        OrderSyncProcessor,
        OrderSyncPipeline,
        OrderLabelService,
        OrderMessagingService,
        OrderMarketplaceDetailsService,
        OrderRectifyService,
        OrderCancellationService,
        // Pricing
        GenericPricingCalculator,
        MercadoLivrePricingCalculator,
        {
            provide: 'PRICING_STRATEGIES',
            useFactory: (generic: GenericPricingCalculator, ml: MercadoLivrePricingCalculator) => {
                return [generic, ml];
            },
            inject: [GenericPricingCalculator, MercadoLivrePricingCalculator],
        },
        PricingCalculatorRegistry,
        OrderPricingService,
        OrderPricingListener,
        OrderFinancialSummaryService,
        OrderSyncFlowService,
    ],
    exports: [OrderService, OrderRepository, OrderProcessingService, OrderOrchestrator, StockOrchestratorService, OrderRectifyService, OrderPricingService, PricingCalculatorRegistry, OrderMarketplaceDetailsService, OrderFinancialSummaryService, OrderCancellationService, OrderSyncFlowService],
})
export class OrderModule { }
