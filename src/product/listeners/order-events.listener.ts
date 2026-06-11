import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderSyncedEvent, OrderProcessedEvent } from '../../order/events/order.events';
import { ProductService } from '../product.service';
import { STOCK_LEDGER_PORT, StockLedgerPort } from '../../order/ports/stock-ledger.port';

@Injectable()
export class OrderEventsListener {
    private readonly logger = new Logger(OrderEventsListener.name);

    constructor(
        private readonly productService: ProductService,
        // Stock writes go through the StockLedgerPort (owned by StockModule). This listener
        // imports only ORDER_EVENTS *types* + the port token — no domain-module cycle.
        @Inject(STOCK_LEDGER_PORT)
        private readonly stockLedger: StockLedgerPort,
    ) { }

    @OnEvent(ORDER_EVENTS.PROCESSED)
    async handleOrderProcessedEvent(event: OrderProcessedEvent) {
        // Proteção contra eventos malformados
        if (!event || !event.items) {
            this.logger.warn(`[OrderProcessed] Received malformed event: ${JSON.stringify(event)}`);
            return;
        }

        this.logger.log(
            `[OrderProcessed] Order ${event.externalId} (${event.marketplaceName}) ready. ` +
            `Items: ${event.items.length}, Total: R$ ${event.totalAmount}, Trigger: ${event.triggeredBy}`,
        );

        // Recovery retries are used to re-emit side effects like notifications for
        // already-processed orders. They must not enqueue new publication syncs.
        if (event.triggeredBy === 'retry') {
            this.logger.log(
                `[OrderProcessed] Skipping for order ${event.externalId} (trigger=retry).`,
            );
            return;
        }

        // Sync enqueue is now handled inside the order pipeline transaction (outbox relay).
        // This listener no longer publishes — doing so here was the old lossy fire-and-forget path.
    }

    @OnEvent(ORDER_EVENTS.SYNCED)
    async handleOrderSyncedEvent(event: OrderSyncedEvent) {
        this.logger.log(`Processing stock deduction for order ${event.externalId}`);
        this.logger.debug(`Order has ${event.items.length} items`);

        try {
            const itemsToDeduct = event.items.map(i => ({
                productId: i.productId ? String(i.productId) : '',
                quantity: i.quantity
            }));

            // Delegate to the product-owned stock ledger for the atomic standalone deduction.
            const result = await this.stockLedger.deductStandalone(
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
