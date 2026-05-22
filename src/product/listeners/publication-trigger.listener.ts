// backend/src/product/listeners/publication-trigger.listener.ts

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { PRODUCT_SECTION_EVENTS, ProductBecameReadyEvent } from '../events/product-section-saved.event';

@Injectable()
export class PublicationTriggerListener {
  private readonly logger = new Logger(PublicationTriggerListener.name);

  constructor(private readonly orchestratorPublisher: OrchestratorPublisherService) {}

  @OnEvent(PRODUCT_SECTION_EVENTS.BECAME_READY)
  async handle(event: ProductBecameReadyEvent): Promise<void> {
    try {
      await this.orchestratorPublisher.requestSync({
        productId: event.productId,
        reason: 'auto_complete',
        force: false,
      });
      this.logger.log(`Auto-publish enqueued for product ${event.productId} (completedAt: ${event.completedAt.toISOString()})`);
    } catch (err) {
      this.logger.error(`Failed to enqueue auto-publish for product ${event.productId}: ${(err as Error).message}`);
    }
  }
}
