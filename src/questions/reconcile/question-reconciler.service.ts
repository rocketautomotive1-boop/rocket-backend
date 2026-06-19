import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { QuestionIngestService } from '../ingest/question-ingest.service';
import { QuestionReconcileCheckpointModel } from './question-reconcile-checkpoint.schema';
import { QUESTION_RECONCILE, nextInterval, maxQuestionCursor } from './question-reconcile-cursor';

/** A scan unit: one ML account, or the default account when none are registered. */
interface ScanTarget {
  accountId?: string;
  label: string;
}

@Injectable()
export class QuestionReconciler {
  private readonly logger = new Logger(QuestionReconciler.name);

  constructor(
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly broker: MarketplaceTokenBrokerService,
    private readonly mercadoLivreAdapter: MercadoLivreAdapter,
    private readonly ingestService: QuestionIngestService,
    @InjectModel(QuestionReconcileCheckpointModel.name)
    private readonly checkpointModel: Model<QuestionReconcileCheckpointModel>,
  ) {}

  /**
   * Fixed tick at the floor cadence; per-account due-gating (isDue) widens the
   * effective interval per account up to the ceiling. Guard against overlap so a
   * slow scan never stacks.
   */
  @Interval(QUESTION_RECONCILE.FLOOR_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err: any) {
      this.logger.error(`[Reconcile] tick failed: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }

  private running = false;

  /**
   * One reconcile pass over every ML account. Each account carries its own
   * checkpoint (cursor + backoff) keyed by (marketplaceId, accountId), so a
   * noisy account never resets a quiet one and a failing account never blocks
   * the rest.
   */
  async runOnce(): Promise<void> {
    const marketplaces = await this.marketplaceRegistry.findAll();
    const mkt = marketplaces.find((m: any) => m.enabled && m.name === 'Mercado Livre');
    if (!mkt) return;

    const marketplaceId = String(mkt._id);
    const accounts = await this.broker.listAccountsWithToken(marketplaceId);
    const targets: ScanTarget[] = accounts.length
      ? accounts.map((a) => ({ accountId: a.accountId, label: a.label }))
      : [{ label: 'default' }];

    for (const target of targets) {
      try {
        await this.scanTarget(marketplaceId, target);
      } catch (err: any) {
        this.logger.error(
          `[Reconcile] account ${target.accountId ?? 'default'} (${target.label}) failed: ${err?.message}`,
        );
      }
    }
  }

  private async scanTarget(marketplaceId: string, target: ScanTarget): Promise<void> {
    const accountId = target.accountId ?? null;
    const token = target.accountId
      ? await this.broker.ensureValidTokenByAccount(marketplaceId, target.accountId)
      : await this.broker.ensureValidToken(marketplaceId);

    const sellerId = String(token.additionalData?.userId ?? '');
    if (!sellerId) {
      this.logger.warn(`[Reconcile] account ${accountId ?? 'default'} has no seller userId; skipping`);
      return;
    }

    const checkpoint = await this.getOrCreateCheckpoint(marketplaceId, accountId);

    // Honor the per-account backoff: a quiet account widens its interval toward
    // the ceiling, so we skip it until its own interval has elapsed.
    if (!this.isDue(checkpoint)) return;

    const since = checkpoint.lastCreatedCursor;

    const delta = await this.mercadoLivreAdapter.listQuestionsSince(token.accessToken, sellerId, since);

    for (const q of delta) {
      await this.ingestService.ingest(String(q.id), 'reconcile', target.accountId);
    }

    const cleanRun = delta.length === 0;
    checkpoint.lastCreatedCursor = maxQuestionCursor(delta, since);
    checkpoint.lastRunAt = new Date();
    checkpoint.consecutiveCleanRuns = cleanRun ? checkpoint.consecutiveCleanRuns + 1 : 0;
    checkpoint.currentIntervalMs = nextInterval(checkpoint.currentIntervalMs, cleanRun);
    await (checkpoint as any).save();
  }

  private isDue(checkpoint: QuestionReconcileCheckpointModel): boolean {
    const lastRun = checkpoint.lastRunAt ? new Date(checkpoint.lastRunAt).getTime() : 0;
    return Date.now() - lastRun >= checkpoint.currentIntervalMs;
  }

  private async getOrCreateCheckpoint(
    marketplaceId: string,
    accountId: string | null,
  ): Promise<QuestionReconcileCheckpointModel & { save: () => Promise<any> }> {
    const existing = await this.checkpointModel.findOne({ marketplaceId, accountId });
    if (existing) return existing as any;
    return (await this.checkpointModel.create({
      marketplaceId,
      accountId,
      lastCreatedCursor: new Date(Date.now() - QUESTION_RECONCILE.BOOTSTRAP_WINDOW_MS),
      // epoch → first tick is immediately due for a freshly seen account
      lastRunAt: new Date(0),
      consecutiveCleanRuns: 0,
      currentIntervalMs: QUESTION_RECONCILE.FLOOR_MS,
    })) as any;
  }
}
