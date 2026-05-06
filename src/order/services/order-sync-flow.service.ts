import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';

@Injectable()
export class OrderSyncFlowService {
    private readonly logger = new Logger(OrderSyncFlowService.name);

    constructor(
        private readonly queueService: QueueService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
    ) {}

    async queueScheduledOrdersSync(params?: { reason?: string; batchSize?: number }): Promise<{
        queued: number;
        skipped: Array<{ marketplace: string; reason: string }>;
    }> {
        const reason = params?.reason || 'hourly_schedule';
        const batchSize = Number(params?.batchSize ?? 50);

        const marketplaces = await this.marketplaceRegistry.findAll();
        const activeMarketplaces = marketplaces.filter((mp) => mp.enabled);

        if (activeMarketplaces.length === 0) {
            this.logger.log('No active marketplaces to sync orders.');
            return { queued: 0, skipped: [] };
        }

        const skipped: Array<{ marketplace: string; reason: string }> = [];
        let queued = 0;

        for (const mp of activeMarketplaces) {
            if (!this.marketplaceOrderService.hasOrderAdapter(mp.name)) {
                skipped.push({ marketplace: mp.name, reason: 'order_adapter_not_found' });
                this.logger.debug(`[OrderSyncFlow] Skipping ${mp.name}: order adapter not found.`);
                continue;
            }

            await this.queueService.addToQueue({
                type: 'orders-sync',
                marketplaceId: String(mp._id),
                priority: 0,
                metadata: { reason, batchSize },
            });
            queued++;
            this.logger.log(`[OrderSyncFlow] Queued orders-sync for Marketplace ${mp.name}`);
        }

        return { queued, skipped };
    }
}

