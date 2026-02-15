import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { QueueModule } from '../queue/queue.module';
import { OrderRepository } from './order.repository';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from './schemas/order.schema';
import { OrderProcessingService } from './services/order-processing.service';
import { OrderOrchestrator } from './services/order-orchestrator.service';
// import { OrderWatcherService } from './order-watcher.service';
import { OrderSyncController } from './controllers/order-sync.controller';
import { OrderSyncProcessor } from './processors/order-sync.processor';
import { OrderMapperService } from './services/order-mapper.service';
import { StockOrchestratorService } from './services/stock-orchestrator.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: OrderModel.name, schema: OrderSchema }
        ]),
        forwardRef(() => MarketplaceModule),
        forwardRef(() => ProductModule),
        forwardRef(() => FiscalModule),
        forwardRef(() => QueueModule),
    ],
    controllers: [OrderController, OrderSyncController],
    providers: [
        OrderService,
        OrderRepository,
        OrderProcessingService,
        OrderOrchestrator,
        // OrderWatcherService, // [DISABLED] Legacy Syncer
        OrderMapperService,
        StockOrchestratorService,
        OrderSyncProcessor,
    ],
    exports: [OrderService, OrderRepository, OrderProcessingService, OrderOrchestrator, StockOrchestratorService],
})
export class OrderModule { }
