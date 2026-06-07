import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReconcileCheckpointModel,
  ReconcileCheckpointDocument,
} from './reconcile-checkpoint.schema';
import { MARKETPLACE_ORDER_GATEWAY, MarketplaceOrderGateway } from '../ports/marketplace-order.gateway';
import { OrderRepository } from '../order.repository';
import { OrderIngestService } from '../ingest/order-ingest.service';
import { OrderMetricsService } from '../observability/order-metrics.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { RECONCILE, nextInterval, maxCursor, isStatusDivergent } from './reconcile-cursor';

/**
 * Safety net for orders the webhook never delivered (or whose status got stuck). Per marketplace
 * it keeps a high-water-mark cursor (date_last_updated) and polls only the delta, feeding gaps
 * into the SAME ingest pipeline. Interval is adaptive: doubles on clean runs (up to a ceiling),
 * resets to the floor whenever a gap is found.
 */
@Injectable()
export class OrderReconciler implements OnModuleInit {
  private readonly logger = new Logger(OrderReconciler.name);
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(ReconcileCheckpointModel.name)
    private readonly checkpoints: Model<ReconcileCheckpointDocument>,
    @Inject(MARKETPLACE_ORDER_GATEWAY)
    private readonly gateway: MarketplaceOrderGateway,
    private readonly repo: OrderRepository,
    private readonly ingest: OrderIngestService,
    private readonly metrics: OrderMetricsService,
    private readonly registry: MarketplaceRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RECONCILER_ENABLED === 'false') {
      this.logger.log('[Reconcile] disabled via RECONCILER_ENABLED=false');
      return;
    }
    const marketplaces = await this.registry.findAll();
    for (const mkt of marketplaces.filter((m: any) => m.enabled)) {
      this.scheduleNext(String(mkt._id), RECONCILE.FLOOR_MS);
    }
  }

  private scheduleNext(marketplaceId: string, delay: number): void {
    const t = setTimeout(
      () =>
        this.runFor(marketplaceId).catch(e =>
          this.logger.error(`[Reconcile] ${marketplaceId} failed: ${(e as Error).message}`),
        ),
      delay,
    );
    this.timers.set(marketplaceId, t);
  }

  async runFor(marketplaceId: string): Promise<void> {
    this.metrics.incReconcileRun();
    const cp = await this.getOrCreateCheckpoint(marketplaceId);
    const refs = await this.gateway.listOrdersSince(marketplaceId, cp.lastUpdatedCursor);

    let gaps = 0;
    for (const ref of refs) {
      const existing = await this.repo.findStatusByExternalId(ref.id);
      if (!existing || isStatusDivergent(existing.status, ref.status)) {
        gaps++;
        await this.ingest.ingest(ref.id, marketplaceId, 'reconcile');
      }
    }

    const cleanRun = gaps === 0;
    cp.lastUpdatedCursor = maxCursor(refs, cp.lastUpdatedCursor);
    cp.lastRunAt = new Date();
    cp.consecutiveCleanRuns = cleanRun ? cp.consecutiveCleanRuns + 1 : 0;
    cp.currentIntervalMs = nextInterval(cp.currentIntervalMs, cleanRun);
    await cp.save();

    this.logger.log(
      `[Reconcile] ${marketplaceId} delta=${refs.length} gaps=${gaps} nextMs=${cp.currentIntervalMs}`,
    );
    this.scheduleNext(marketplaceId, cp.currentIntervalMs);
  }

  private async getOrCreateCheckpoint(marketplaceId: string): Promise<ReconcileCheckpointDocument> {
    const existing = await this.checkpoints.findOne({ marketplaceId });
    if (existing) return existing;
    return this.checkpoints.create({
      marketplaceId,
      lastUpdatedCursor: new Date(Date.now() - RECONCILE.BOOTSTRAP_WINDOW_MS),
      currentIntervalMs: RECONCILE.FLOOR_MS,
      consecutiveCleanRuns: 0,
    });
  }
}
