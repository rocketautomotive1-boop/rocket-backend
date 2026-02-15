import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderSyncedEvent } from '../../order/events/order.events';
import { ProductService } from '../product.service';
import { StockOrchestratorService } from '../../order/services/stock-orchestrator.service';

@Injectable()
export class OrderEventsListener {
    private readonly logger = new Logger(OrderEventsListener.name);

    constructor(
        private readonly productService: ProductService,
        @Inject(forwardRef(() => StockOrchestratorService))
        private readonly stockOrchestrator: StockOrchestratorService
    ) { }

    @OnEvent(ORDER_EVENTS.SYNCED)
    async handleOrderSyncedEvent(event: OrderSyncedEvent) {
        this.logger.log(`Processing stock deduction for order ${event.externalId}`);
        this.logger.debug(`Order has ${event.items.length} items`);

        try {
            const itemsToDeduct = event.items.map(i => ({
                productId: i.productId ? String(i.productId) : '',
                quantity: i.quantity
            }));

            // Delegate to Orchestrator for Atomic Transaction (Check -> Deduct -> Status Update -> Notify)
            const result = await this.stockOrchestrator.deductStock(
                String(event.orderId),
                itemsToDeduct,
                String(event.externalId),
                event.marketplaceName || 'Marketplace'
            );

            this.logger.log(`Stock deduction result for ${event.externalId}: ${JSON.stringify(result)}`);

        } catch (error) {
            this.logger.error(`Error in handleOrderSyncedEvent for ${event.externalId}: ${error.message}`);
        }
    }
}
