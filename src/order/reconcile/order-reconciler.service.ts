import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReconcileCheckpointModel,
  ReconcileCheckpointDocument,
  FailedRef,
} from './reconcile-checkpoint.schema';
import { MARKETPLACE_ORDER_GATEWAY, MarketplaceOrderGateway, ExternalOrderRef } from '../ports/marketplace-order.gateway';
import { OrderRepository } from '../order.repository';
import { OrderIngestService } from '../ingest/order-ingest.service';
import { OrderMetricsService } from '../observability/order-metrics.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import {
  RECONCILE,
  nextInterval,
  maxCursor,
  isStatusDivergent,
  isShippingPossiblyStale,
  failedRefBackoff,
} from './reconcile-cursor';

interface Target {
  marketplaceId: string;
  accountId?: string;
}

/**
 * Safety net for orders the webhook never delivered (or whose status got stuck). Per marketplace
 * it keeps a high-water-mark cursor (date_last_updated) and polls only the delta, feeding gaps
 * into the SAME ingest pipeline. Interval is adaptive: doubles on clean runs (up to a ceiling),
 * resets to the floor whenever a gap is found.
 *
 * Resiliência (incidente 18–20/set/2026): antes, cada alvo era uma cadeia de setTimeout em memória
 * que só se re-armava no fim de uma execução bem-sucedida — um único 404 transitório do ML matava
 * o reconciler daquela conta até o próximo restart, e as vendas deixavam de ser reconciliadas sem
 * ninguém perceber. Agora:
 *  - a agenda é PERSISTIDA (`nextRunAt` no checkpoint) e um único `tick` fixo executa tudo que
 *    venceu: nenhuma falha consegue "esquecer" um alvo, e contas novas são descobertas sem restart;
 *  - falha por pedido é isolada em `failedRefs` (retry com backoff, `dead` após N tentativas): o
 *    cursor avança e nada se perde em silêncio;
 *  - checkpoint parado além do limite gera erro de log `[STALE]` (alerta).
 */
@Injectable()
export class OrderReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderReconciler.name);
  private tickTimer?: NodeJS.Timeout;
  private targets: Target[] = [];
  private targetsRefreshedAt = 0;
  private ticking = false;
  /** Alvos em execução agora (evita sobreposição entre ticks). */
  private readonly running = new Set<string>();

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

  /** Chave estável do checkpoint por (marketplace, conta). */
  private key(marketplaceId: string, accountId?: string | null): string {
    return accountId ? `${marketplaceId}:${accountId}` : marketplaceId;
  }

  onModuleInit(): void {
    if (process.env.RECONCILER_ENABLED === 'false') {
      this.logger.log('[Reconcile] disabled via RECONCILER_ENABLED=false');
      return;
    }
    this.tickTimer = setInterval(() => {
      this.tick().catch(e => this.logger.error(`[Reconcile] tick failed: ${(e as Error).message}`));
    }, RECONCILE.TICK_MS);
    this.tickTimer.unref?.();
    // 1º tick imediato (sem esperar TICK_MS), sem bloquear o boot.
    this.tick().catch(e => this.logger.error(`[Reconcile] tick failed: ${(e as Error).message}`));
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  /**
   * Supervisor: redescobre alvos (marketplaces habilitados × contas com token) de tempos em
   * tempos e executa todo checkpoint vencido. Tolerante a falha em qualquer alvo — um erro
   * nunca impede os demais nem o próximo tick.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (Date.now() - this.targetsRefreshedAt >= RECONCILE.TARGET_REFRESH_MS || this.targets.length === 0) {
        await this.refreshTargets();
      }
      const now = new Date();
      for (const t of this.targets) {
        const k = this.key(t.marketplaceId, t.accountId);
        if (this.running.has(k)) continue;
        const due = await this.checkpoints
          .findOne({
            marketplaceId: t.marketplaceId,
            accountId: t.accountId ?? null,
            $or: [{ nextRunAt: null }, { nextRunAt: { $lte: now } }],
          })
          .select('_id')
          .lean();
        if (!due) continue;
        this.running.add(k);
        try {
          await this.runFor(t.marketplaceId, t.accountId);
        } catch (e) {
          this.logger.error(`[Reconcile] ${k} failed: ${(e as Error).message}`);
        } finally {
          this.running.delete(k);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async refreshTargets(): Promise<void> {
    const targets: Target[] = [];
    const marketplaces = await this.registry.findAll();
    for (const mkt of marketplaces.filter((m: any) => m.enabled)) {
      const marketplaceId = String(mkt._id);
      // Uma varredura por conta multi-client (cada uma com seu cursor). Sem
      // accounts[] → uma varredura na conta default (accountId undefined).
      let accountIds: Array<string | undefined>;
      try {
        const accounts = await this.broker.listAccountsWithToken(marketplaceId);
        accountIds = accounts.length ? accounts.map(a => a.accountId) : [undefined];
      } catch (e) {
        // Não derruba os outros marketplaces; mantém os alvos já conhecidos deste.
        this.logger.error(`[Reconcile] listAccounts ${marketplaceId} failed: ${(e as Error).message}`);
        accountIds = this.targets.filter(t => t.marketplaceId === marketplaceId).map(t => t.accountId);
      }
      for (const accountId of accountIds) {
        targets.push({ marketplaceId, accountId });
        await this.getOrCreateCheckpoint(marketplaceId, accountId);
      }
    }
    this.targets = targets;
    this.targetsRefreshedAt = Date.now();
    await this.alertIfStale();
  }

  /** Alerta (log de erro) quando um alvo ativo está sem rodar além do limite — o reconciler parou. */
  private async alertIfStale(): Promise<void> {
    const threshold = new Date(Date.now() - RECONCILE.STALE_AFTER_MS);
    for (const t of this.targets) {
      const cp = await this.checkpoints
        .findOne({ marketplaceId: t.marketplaceId, accountId: t.accountId ?? null })
        .select('lastRunAt createdAt failedRefs')
        .lean();
      if (!cp) continue;
      const last = cp.lastRunAt ?? (cp as any).createdAt;
      if (last && last < threshold) {
        this.logger.error(
          `[Reconcile][STALE] ${this.key(t.marketplaceId, t.accountId)} sem executar desde ${new Date(last).toISOString()}`,
        );
      }
      const dead = (cp.failedRefs ?? []).filter(f => f.dead);
      if (dead.length) {
        this.logger.error(
          `[Reconcile][DEAD] ${this.key(t.marketplaceId, t.accountId)} ${dead.length} pedido(s) esgotaram as tentativas: ${dead.map(d => d.externalId).join(', ')}`,
        );
      }
    }
  }

  async runFor(marketplaceId: string, accountId?: string): Promise<void> {
    this.metrics.incReconcileRun();
    const cp = await this.getOrCreateCheckpoint(marketplaceId, accountId);
    const k = this.key(marketplaceId, accountId);
    const now = new Date();

    let refs: ExternalOrderRef[] = [];
    let listError: Error | undefined;
    try {
      refs = await this.gateway.listOrdersSince(marketplaceId, cp.lastUpdatedCursor, accountId);
    } catch (e) {
      listError = e as Error;
      this.logger.error(`[Reconcile] ${k} falha ao listar delta: ${listError.message}`);
    }

    // toObject(): subdocs hidratados não são espalháveis ({...f} perde os campos)
    const failed = new Map<string, FailedRef>(
      ((cp.toObject().failedRefs ?? []) as FailedRef[]).map(f => [f.externalId, { ...f }]),
    );
    let gaps = 0;
    let failures = 0;

    const attempt = async (id: string, doIngest: () => Promise<void>): Promise<void> => {
      gaps++;
      try {
        await doIngest();
        failed.delete(id);
      } catch (e) {
        failures++;
        const prev = failed.get(id);
        const attempts = (prev?.attempts ?? 0) + 1;
        const dead = attempts >= RECONCILE.MAX_FAILED_ATTEMPTS;
        failed.set(id, {
          externalId: id,
          attempts,
          nextRetryAt: new Date(Date.now() + failedRefBackoff(attempts)),
          lastError: (e as Error).message,
          dead,
        });
        this.logger.error(
          `[Reconcile] ${k} pedido ${id} falhou (tentativa ${attempts}${dead ? ', DEAD' : ''}): ${(e as Error).message}`,
        );
      }
    };

    const seen = new Set<string>();
    for (const ref of refs) {
      seen.add(ref.id);
      const prev = failed.get(ref.id);
      // Pedido na fila de falhas só é retentado quando vence o backoff (e não está dead).
      if (prev && (prev.dead || prev.nextRetryAt > now)) continue;
      try {
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
        if (!existing || isStatusDivergent(existing.status, ref.status) || needsShippingRefresh || prev) {
          await attempt(ref.id, () => this.ingest.ingest(ref.id, marketplaceId, 'reconcile', accountId));
        }
      } catch (e) {
        // falha ao consultar o estado local: trata como falha do pedido (retentado), não do lote
        await attempt(ref.id, () => Promise.reject(e));
      }
    }

    // Retry de pedidos que falharam e não apareceram no delta desta rodada.
    for (const f of [...failed.values()]) {
      if (seen.has(f.externalId) || f.dead || f.nextRetryAt > now) continue;
      await attempt(f.externalId, () => this.ingest.ingest(f.externalId, marketplaceId, 'reconcile', accountId));
    }

    const cleanRun = !listError && gaps === 0 && failures === 0;
    if (!listError) cp.lastUpdatedCursor = maxCursor(refs, cp.lastUpdatedCursor);
    cp.failedRefs = [...failed.values()];
    cp.lastRunAt = new Date();
    cp.lastError = listError ? listError.message : null;
    cp.consecutiveCleanRuns = cleanRun ? cp.consecutiveCleanRuns + 1 : 0;
    cp.currentIntervalMs = nextInterval(cp.currentIntervalMs, cleanRun);
    // Falha de listagem ou pedidos pendentes de retry → volta rápido (piso); senão intervalo adaptativo.
    const hasPendingRetry = cp.failedRefs.some(f => !f.dead);
    const delay = listError || hasPendingRetry ? RECONCILE.FLOOR_MS : cp.currentIntervalMs;
    cp.nextRunAt = new Date(Date.now() + delay);
    await cp.save();

    this.logger.log(
      `[Reconcile] ${k} delta=${refs.length} gaps=${gaps} failures=${failures} pendingRetry=${cp.failedRefs.length} nextMs=${delay}`,
    );
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
