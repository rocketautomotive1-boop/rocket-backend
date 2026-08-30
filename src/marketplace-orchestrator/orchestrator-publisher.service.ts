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
    /**
     * DELETE originado de moderação (WrongCategoryHandler) — diferente de exclusão manual pelo
     * usuário. Percorre até SyncResultConsumer, que usa isso pra decidir o status final do
     * listing: 'removed' (manual, nunca reentra sozinho num sync futuro — ver
     * SyncQueueTargetResolverService/PublicationContextService, ambos filtram status:'removed')
     * vs 'removed_by_moderation' (elegível a reentrar quando o produto ficar ready de novo).
     */
    moderationDelete?: boolean;
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
