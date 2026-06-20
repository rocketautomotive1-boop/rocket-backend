import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrderModel, OrderSchema } from './schemas/order.schema';
import {
    ReconcileCheckpointModel,
    ReconcileCheckpointSchema,
} from './reconcile/reconcile-checkpoint.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { QueueRecordModel, QueueRecordSchema } from '../queue/schemas/queue-record.schema';

import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';
import { QueueModule } from '../queue/queue.module';
import { StockModule } from '../stock/stock.module';
import { OutboxModule } from '../outbox/outbox.module';

import { OrderRepository } from './order.repository';
import { OrderController } from './order.controller';
import { OrderSyncController } from './controllers/order-sync.controller';
import { OrderTestController } from './controllers/order-test.controller';

// Ingest
import { OrderIngestService } from './ingest/order-ingest.service';
import { OrderSyncPipeline } from './ingest/order-sync.pipeline';
import { OrderIngestListener } from './ingest/order-ingest.listener';
import { OrderMapperService } from './ingest/order-mapper.service';

// Reconcile
import { OrderReconciler } from './reconcile/order-reconciler.service';
import { GapDetector } from './reconcile/gap-detector.service';
import { OrderRectifyService } from './reconcile/order-rectify.service';

// Query / lifecycle / fulfillment
import { OrderQueryService } from './query/order-query.service';
import { OrderLifecycleService } from './lifecycle/order-lifecycle.service';
import { OrderCancellationService } from './lifecycle/order-cancellation.service';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';

// Observability
import { OrderMetricsService } from './observability/order-metrics.service';

// Marketplace-detail / label / messaging (kept; consumed by financial summary + controllers)
import { OrderLabelService } from './services/order-label.service';
import { OrderMessagingService } from './services/order-messaging.service';
import { OrderMarketplaceDetailsService } from './services/order-marketplace-details.service';

// Pricing (unchanged — already strategy-based)
import { OrderPricingService } from './services/order-pricing.service';
import { PricingCalculatorRegistry } from './registries/pricing-calculator.registry';
import { GenericPricingCalculator } from './strategies/generic-pricing.calculator';
import { MercadoLivrePricingCalculator } from './strategies/mercadolivre-pricing.calculator';
import { OrderPricingListener } from './listeners/order-pricing.listener';
import { OrderFinancialSummaryService } from './services/order-financial-summary.service';

// WhatsApp sale-notification subsystem (business logic owned by order/)
import { OrderSaleNotificationListener } from './listeners/order-sale-notification.listener';
import { SaleNotificationReconcilerService } from './services/sale-notification-reconciler.service';
import { DailyReportService } from './services/daily-report.service';
import { OrderBotQueryService } from './services/order-bot-query.service';
import { SALES_QUERY_PORT } from '../notifications/bot/ports/bot-query.ports';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

/**
 * Hexagonal order core. Inbound is event-driven (webhook domain commands → OrderIngestListener,
 * ORDER_EVENTS out). Outbound cross-domain calls go through ports (MARKETPLACE_ORDER_GATEWAY,
 * STOCK_LEDGER_PORT, PRODUCT_RESOLVER_PORT) implemented by MarketplaceModule / ProductModule.
 * No forwardRef: Marketplace/Product no longer import OrderModule.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: OrderModel.name, schema: OrderSchema },
            { name: ReconcileCheckpointModel.name, schema: ReconcileCheckpointSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: QueueRecordModel.name, schema: QueueRecordSchema },
        ]),
        MarketplaceModule,
        ProductModule,
        QueueModule,
        StockModule,
        OutboxModule,
        WhatsAppModule, // WHATSAPP_PORT para daily-report (envio direto pelo dono do dado)
    ],
    controllers: [OrderController, OrderSyncController, OrderTestController],
    providers: [
        OrderRepository,
        // ingest
        OrderIngestService,
        OrderSyncPipeline,
        OrderIngestListener,
        OrderMapperService,
        // reconcile
        OrderReconciler,
        GapDetector,
        OrderRectifyService,
        // query / lifecycle / fulfillment
        OrderQueryService,
        OrderLifecycleService,
        OrderCancellationService,
        OrderFulfillmentService,
        // observability
        OrderMetricsService,
        // marketplace-detail / label / messaging
        OrderLabelService,
        OrderMessagingService,
        OrderMarketplaceDetailsService,
        // pricing
        GenericPricingCalculator,
        MercadoLivrePricingCalculator,
        {
            provide: 'PRICING_STRATEGIES',
            useFactory: (generic: GenericPricingCalculator, ml: MercadoLivrePricingCalculator) => [generic, ml],
            inject: [GenericPricingCalculator, MercadoLivrePricingCalculator],
        },
        PricingCalculatorRegistry,
        OrderPricingService,
        OrderPricingListener,
        OrderFinancialSummaryService,
        // WhatsApp sale-notification (business logic in order/)
        OrderSaleNotificationListener,
        SaleNotificationReconcilerService,
        DailyReportService,
        OrderBotQueryService,
        { provide: SALES_QUERY_PORT, useExisting: OrderBotQueryService },
    ],
    exports: [
        OrderRepository,
        OrderIngestService,
        OrderQueryService,
        OrderLifecycleService,
        OrderRectifyService,
        OrderCancellationService,
        OrderFulfillmentService,
        OrderMarketplaceDetailsService,
        OrderPricingService,
        PricingCalculatorRegistry,
        OrderFinancialSummaryService,
        // Bot read-port consumed by NotificationsModule
        SALES_QUERY_PORT,
    ],
})
export class OrderModule { }
