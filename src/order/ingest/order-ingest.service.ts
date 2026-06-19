import { Injectable, Logger } from '@nestjs/common';
import { OrderSyncPipeline } from './order-sync.pipeline';
import { IngestSource } from './order-ingest.decision';
import { OrderMetricsService } from '../observability/order-metrics.service';

/**
 * Single entry point for order ingestion. Webhook listener, reconciler and manual sync all
 * call ingest() — there is exactly one code path into the transactional/idempotent pipeline.
 * Ingest is direct (no queue): the pipeline itself is idempotent and transactional.
 */
@Injectable()
export class OrderIngestService {
  private readonly logger = new Logger(OrderIngestService.name);

  constructor(
    private readonly pipeline: OrderSyncPipeline,
    private readonly metrics: OrderMetricsService,
  ) {}

  /**
   * `accountId` (opcional) identifica a conta multi-client que recebeu o pedido,
   * resolvida na borda do webhook a partir do user_id do marketplace. Ausente →
   * conta default (single-client legado).
   */
  async ingest(externalId: string, marketplaceId: string, source: IngestSource = 'sync', accountId?: string): Promise<void> {
    this.logger.log(`[Ingest] ${externalId} mkt=${marketplaceId} source=${source}${accountId ? ` account=${accountId}` : ''}`);
    this.metrics.incIngest(source);
    await this.pipeline.execute(externalId, marketplaceId, source, accountId);
  }
}
