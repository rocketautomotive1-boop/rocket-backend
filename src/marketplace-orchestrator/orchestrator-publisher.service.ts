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
     * Listing específico a excluir — sem isso, um produto multi-loja (múltiplos listings no
     * mesmo marketplace) faz o DELETE resolver TODOS os listings daquele produto+marketplace;
     * se algum outro nunca foi publicado (sem externalId), PayloadBuilderService lança erro
     * síncrono pra ele e mascara o resultado do listing certo (o que a moderação queria
     * excluir). Usado só por action:'DELETE' — publish normal continua resolvendo todos os
     * listings elegíveis do produto.
     */
    listingId?: string;
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
