import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MarketplaceSyncResult } from './dto/marketplace-sync-result.dto';

/**
 * Listens for sync results published by orchestrator-ms.
 * Result processing (listing status updates) is now handled by orchestrator-ms.
 * This listener is kept as a no-op stub to avoid queue build-up.
 */
@Injectable()
export class ListingStatusListener {
    private readonly logger = new Logger(ListingStatusListener.name);

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
    })
    async handleSyncResult(result: MarketplaceSyncResult) {
        this.logger.debug(`[ListingStatusListener] Received result for listing ${result?.listingId} — handled by orchestrator-ms`);
    }
}

