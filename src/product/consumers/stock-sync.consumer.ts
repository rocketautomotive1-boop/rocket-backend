import { Injectable, Logger, Inject } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { ProductRepository } from '../product.repository';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';

@Injectable()
export class StockSyncConsumer {
    private readonly logger = new Logger(StockSyncConsumer.name);

    constructor(
        private readonly marketplaceService: MarketplaceService,
        private readonly productRepository: ProductRepository,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.inventory',
        routingKey: 'stock.changed.*',
        queue: 'sync.marketplaces.general', // Or specific e.g., 'sync.marketplaces.ml'
    })
    public async handleStockChange(msg: any) {
        this.logger.log(`[RabbitMQ] Received stock change: ${JSON.stringify(msg)}`);

        const { productId, source, marketplaceId } = msg;

        // Anti-Loop Logic: If source is 'order_sync', ignore the origin marketplace
        // Implementation TODO: MarketplaceService needs to support updating specific or all markets

        // 1. Get Current Real Stock
        const currentStock = (await this.stockQuery.getProductStock(productId)).onHand;

        // 2. Broadcast Update
        // If source is 'order_sync', we pass the 'marketplaceId' to Exclude
        const excludeMarketplaceId = (source === 'order_sync') ? marketplaceId : null;

        this.logger.log(`[RabbitMQ] Broadcasting stock ${currentStock} for ${productId} (Excluded: ${excludeMarketplaceId || 'None'})`);

        // Ideally, we would have a method updateStockInAllMarketplaces(productId, stock, excludeId)
        // For now, let's assume updateStock on MarketplaceService handles this or we iterate.
        // Let's call a method we should implement in MarketplaceService.

        await this.marketplaceService.updateStockInAllMarketplaces(productId, currentStock, excludeMarketplaceId);
    }
}
