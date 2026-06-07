import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderRepository } from '../order.repository';
import { OrderMetricsService } from '../observability/order-metrics.service';
import {
  OrderSyncRequestedCommand,
  WEBHOOK_DOMAIN_COMMANDS,
} from '../../webhook/events/webhook.events';

/**
 * Observational accelerator: when a webhook sync command arrives for an order we have never
 * seen locally, record it as a first-seen gap (signal for webhook-vs-reconcile health).
 * The actual ingestion is performed by OrderIngestListener on the same event; this service
 * only measures.
 */
@Injectable()
export class GapDetector {
  private readonly logger = new Logger(GapDetector.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly metrics: OrderMetricsService,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, { async: true })
  async onSyncRequested(cmd: OrderSyncRequestedCommand): Promise<void> {
    const existing = await this.repo.findStatusByExternalId(cmd.externalOrderId);
    if (!existing) {
      this.metrics.incGapDetected('webhook_first_seen');
      this.logger.debug(`[GapDetector] first-seen order ${cmd.externalOrderId}`);
    }
  }
}
