import { Injectable, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { OutboxRepository } from '../outbox/outbox.repository';

export interface SyncRequestedEvent {
    productId: string;
    reason?: string;
    requesterId?: string;
    resolutionSignal?: string;
    targetMarketplaceIds?: string[];
    scheduledAt?: string;
    action?: 'DELETE';
}

@Injectable()
export class OrchestratorPublisherService {
    private readonly logger = new Logger(OrchestratorPublisherService.name);

    constructor(private readonly outbox: OutboxRepository) {}

    async requestSync(event: SyncRequestedEvent, session?: ClientSession): Promise<void> {
        await this.outbox.enqueue(
            { exchange: 'rocket.orchestrator', routingKey: 'product.sync.requested', payload: event },
            { session },
        );
        this.logger.log(`Outboxed sync.requested for product ${event.productId} (reason: ${event.reason})`);
    }
}
