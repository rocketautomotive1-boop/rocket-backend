import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderSyncedEvent, OrderProcessedEvent } from '../../order/events/order.events';
import { ProductService } from '../product.service';
import { STOCK_LEDGER_PORT, StockLedgerPort } from '../../order/ports/stock-ledger.port';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';

@Injectable()
export class OrderEventsListener {
    private readonly logger = new Logger(OrderEventsListener.name);

    constructor(
        private readonly productService: ProductService,
        // Stock writes go through the StockLedgerPort (owned by StockModule). This listener
        // imports only ORDER_EVENTS *types* + the port token — no domain-module cycle.
        @Inject(STOCK_LEDGER_PORT)
        private readonly stockLedger: StockLedgerPort,
        @Inject(forwardRef(() => OrchestratorPublisherService))
        private readonly orchestratorPublisher: OrchestratorPublisherService,
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
                `[OrderProcessed] Skipping publication enqueue for order ${event.externalId} (trigger=retry).`,
            );
            return;
        }

        // After stock deduction, enqueue marketplace publish for each affected product
        // so listing stock quantities are updated across all marketplaces.
        const productIds = [...new Set(
            event.items.map(i => i.productId).filter(id => !!id),
        )];

        if (productIds.length > 0) {
            this.logger.log(
                `[OrderProcessed] Enqueuing stock sync for ${productIds.length} product(s): ${productIds.join(', ')}`,
            );
        }

        for (const productId of productIds) {
            try {
                await this.orchestratorPublisher.requestSync({
                    productId,
                    reason: 'stock_deduction',
                });
            } catch (err) {
                this.logger.error(`[OrderProcessed] Failed to enqueue sync for product ${productId}: ${(err as Error).message}`);
            }
        }
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
