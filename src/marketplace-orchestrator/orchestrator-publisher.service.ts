import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

export interface SyncRequestedEvent {
    productId: string;
    reason?: string;
    force?: boolean;
    requesterId?: string;
    resolutionSignal?: string;
    targetMarketplaceIds?: string[];
    scheduledAt?: string;
}

@Injectable()
export class OrchestratorPublisherService {
    private readonly logger = new Logger(OrchestratorPublisherService.name);

    constructor(private readonly amqp: AmqpConnection) {}

    async requestSync(event: SyncRequestedEvent): Promise<void> {
        await this.amqp.publish('rocket.orchestrator', 'product.sync.requested', event);
        this.logger.log(`Published sync.requested for product ${event.productId} (reason: ${event.reason})`);
    }
}
