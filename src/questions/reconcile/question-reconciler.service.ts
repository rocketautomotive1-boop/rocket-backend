import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  QuestionReconcileCheckpointModel,
  QuestionReconcileCheckpointDocument,
} from './question-reconcile-checkpoint.schema';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { QuestionRepository } from '../question.repository';
import { QuestionIngestService } from '../ingest/question-ingest.service';
import { QUESTION_RECONCILE, nextInterval, maxQuestionCursor, isStatusDivergent } from './question-reconcile-cursor';

@Injectable()
export class QuestionReconciler implements OnModuleInit {
  private readonly logger = new Logger(QuestionReconciler.name);
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(QuestionReconcileCheckpointModel.name)
    private readonly checkpoints: Model<QuestionReconcileCheckpointDocument>,
    private readonly adapter: MercadoLivreAdapter,
    private readonly registry: MarketplaceRegistryService,
    private readonly auth: MarketplaceAuthService,
    private readonly repo: QuestionRepository,
    private readonly ingest: QuestionIngestService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.QUESTION_RECONCILER_ENABLED === 'false') {
      this.logger.log('[QReconcile] disabled via QUESTION_RECONCILER_ENABLED=false');
      return;
    }
    const marketplaces = await this.registry.findAll();
    for (const mkt of marketplaces.filter((m: any) => m.enabled && m.name === 'Mercado Livre')) {
      this.scheduleNext(String(mkt._id), QUESTION_RECONCILE.FLOOR_MS);
    }
  }

  private scheduleNext(marketplaceId: string, delay: number): void {
    const t = setTimeout(
      () => this.runFor(marketplaceId).catch(e =>
        this.logger.error(`[QReconcile] ${marketplaceId} failed: ${(e as Error).message}`),
      ),
      delay,
    );
    this.timers.set(marketplaceId, t);
  }

  async runFor(marketplaceId: string): Promise<void> {
    const cp = await this.getOrCreateCheckpoint(marketplaceId);

    const mkt = (await this.registry.findAll()).find((m: any) => String(m._id) === marketplaceId);
    let sellerId: string | undefined;
    let token: string | undefined;
    try {
      const active = await this.auth.ensureValidToken(mkt._id);
      token = active?.accessToken;
      sellerId = active?.additionalData?.userId;
    } catch (e) {
      this.logger.warn(`[QReconcile] ${marketplaceId} token unavailable: ${(e as Error).message}`);
    }

    let refs: Array<{ id: string; item_id: string; status: string; date_created: string }> = [];
    if (token && sellerId) {
      refs = await this.adapter.listQuestionsSince(token, sellerId, cp.lastCreatedCursor);
    }

    let gaps = 0;
    for (const ref of refs) {
      const existing = await this.repo.findOne({ externalId: ref.id });
      if (!existing || isStatusDivergent(existing.status, ref.status)) {
        gaps++;
        await this.ingest.ingest(ref.id, 'reconcile');
      }
    }

    const cleanRun = gaps === 0;
    cp.lastCreatedCursor = maxQuestionCursor(refs, cp.lastCreatedCursor);
    cp.lastRunAt = new Date();
    cp.consecutiveCleanRuns = cleanRun ? cp.consecutiveCleanRuns + 1 : 0;
    cp.currentIntervalMs = nextInterval(cp.currentIntervalMs, cleanRun);
    await cp.save();

    this.logger.log(`[QReconcile] ${marketplaceId} delta=${refs.length} gaps=${gaps} nextMs=${cp.currentIntervalMs}`);
    this.scheduleNext(marketplaceId, cp.currentIntervalMs);
  }

  private async getOrCreateCheckpoint(marketplaceId: string): Promise<QuestionReconcileCheckpointDocument> {
    const existing = await this.checkpoints.findOne({ marketplaceId });
    if (existing) return existing;
    return this.checkpoints.create({
      marketplaceId,
      lastCreatedCursor: new Date(Date.now() - QUESTION_RECONCILE.BOOTSTRAP_WINDOW_MS),
      currentIntervalMs: QUESTION_RECONCILE.FLOOR_MS,
      consecutiveCleanRuns: 0,
    });
  }
}
