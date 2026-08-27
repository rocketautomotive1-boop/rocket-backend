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
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { RECONCILE, nextInterval, maxCursor, isStatusDivergent, isShippingPossiblyStale } from './reconcile-cursor';

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
    private readonly broker: MarketplaceTokenBrokerService,
  ) {}

  /** Chave estável do timer/checkpoint por (marketplace, conta). */
  private key(marketplaceId: string, accountId?: string | null): string {
    return accountId ? `${marketplaceId}:${accountId}` : marketplaceId;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.RECONCILER_ENABLED === 'false') {
      this.logger.log('[Reconcile] disabled via RECONCILER_ENABLED=false');
      return;
    }
    const marketplaces = await this.registry.findAll();
    for (const mkt of marketplaces.filter((m: any) => m.enabled)) {
      const marketplaceId = String(mkt._id);
      // Uma varredura por conta multi-client (cada uma com seu cursor). Sem
      // accounts[] → uma varredura na conta default (accountId undefined).
      const accounts = await this.broker.listAccountsWithToken(marketplaceId);
      const targets = accounts.length ? accounts.map(a => a.accountId) : [undefined];
      for (const accountId of targets) {
        this.scheduleNext(marketplaceId, RECONCILE.FLOOR_MS, accountId);
      }
    }
  }

  private scheduleNext(marketplaceId: string, delay: number, accountId?: string): void {
    const t = setTimeout(
      () =>
        this.runFor(marketplaceId, accountId).catch(e =>
          this.logger.error(`[Reconcile] ${this.key(marketplaceId, accountId)} failed: ${(e as Error).message}`),
        ),
      delay,
    );
    this.timers.set(this.key(marketplaceId, accountId), t);
  }

  async runFor(marketplaceId: string, accountId?: string): Promise<void> {
    this.metrics.incReconcileRun();
    const cp = await this.getOrCreateCheckpoint(marketplaceId, accountId);
    const refs = await this.gateway.listOrdersSince(marketplaceId, cp.lastUpdatedCursor, accountId);

    let gaps = 0;
    for (const ref of refs) {
      const existing = await this.repo.findStatusByExternalId(ref.id);
      // Rede de segurança p/ shipping: o pedido apareceu no delta (date_last_updated moveu
      // no ML — toda transição de shipment atualiza esse campo, confirmado ao vivo), mas o
      // status COMERCIAL não divergiu porque a mudança foi só de shipping.substatus. Sem
      // isso, um webhook de shipments perdido deixa o substatus congelado indefinidamente
      // (bug confirmado em produção: pedido travado ~24h em 'invoice_pending' enquanto o
      // shipment real avançou 7 estados). Só reingesta se o substatus local ainda não é
      // terminal — evita reingestar pedidos entregues/cancelados a cada ciclo.
      const needsShippingRefresh = !!existing
        && !isStatusDivergent(existing.status, ref.status)
        && isShippingPossiblyStale(existing.shipping?.substatus);
      if (!existing || isStatusDivergent(existing.status, ref.status) || needsShippingRefresh) {
        gaps++;
        await this.ingest.ingest(ref.id, marketplaceId, 'reconcile', accountId);
      }
    }

    const cleanRun = gaps === 0;
    cp.lastUpdatedCursor = maxCursor(refs, cp.lastUpdatedCursor);
    cp.lastRunAt = new Date();
    cp.consecutiveCleanRuns = cleanRun ? cp.consecutiveCleanRuns + 1 : 0;
    cp.currentIntervalMs = nextInterval(cp.currentIntervalMs, cleanRun);
    await cp.save();

    this.logger.log(
      `[Reconcile] ${this.key(marketplaceId, accountId)} delta=${refs.length} gaps=${gaps} nextMs=${cp.currentIntervalMs}`,
    );
    this.scheduleNext(marketplaceId, cp.currentIntervalMs, accountId);
  }

  private async getOrCreateCheckpoint(marketplaceId: string, accountId?: string): Promise<ReconcileCheckpointDocument> {
    const filter = { marketplaceId, accountId: accountId ?? null };
    const existing = await this.checkpoints.findOne(filter);
    if (existing) return existing;
    return this.checkpoints.create({
      ...filter,
      lastUpdatedCursor: new Date(Date.now() - RECONCILE.BOOTSTRAP_WINDOW_MS),
      currentIntervalMs: RECONCILE.FLOOR_MS,
      consecutiveCleanRuns: 0,
    });
  }
}
