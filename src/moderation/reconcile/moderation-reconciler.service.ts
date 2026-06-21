import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { MlModerationsClient } from '../ml/ml-moderations.client';
import { MercadoLivreModerationProvider } from '../providers/mercadolivre-moderation.provider';
import { ModerationRepository } from '../moderation.repository';
import { ModerationIngestService } from '../ingest/moderation-ingest.service';
import { diffModerations } from './moderation-diff';

/** Adaptive interval, mirroring the order reconciler. */
const RECON = {
  FLOOR_MS: 5 * 60 * 1000,
  CEILING_MS: 20 * 60 * 1000,
};
const nextInterval = (current: number, cleanRun: boolean): number =>
  cleanRun ? Math.min(current * 2, RECON.CEILING_MS) : RECON.FLOOR_MS;

/**
 * PRIMARY moderation source of truth. ML has no `moderations` webhook topic — infractions are
 * discovered by polling /infractions. Per (marketplace, account) this fetches active infractions,
 * diffs them against our open moderation_state rows, then:
 *   - ingests the active ones (upsert open + apply handler), and
 *   - RESOLVES rows that vanished from /infractions — closing the state and clearing the listing's
 *     pending_removal/syncIssue, then asking the orchestrator to re-publish. The old polling never
 *     closed anything, so local state diverged and got stuck; this is the fix.
 * The interval is adaptive (doubles on clean runs, resets to the floor when a change is found).
 */
@Injectable()
export class ModerationReconciler implements OnModuleInit {
  private readonly logger = new Logger(ModerationReconciler.name);
  private readonly mlProvider = new MercadoLivreModerationProvider();
  private timers = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, number>();

  constructor(
    @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    private readonly registry: MarketplaceRegistryService,
    private readonly broker: MarketplaceTokenBrokerService,
    private readonly mlClient: MlModerationsClient,
    private readonly repo: ModerationRepository,
    private readonly ingest: ModerationIngestService,
    private readonly publisher: OrchestratorPublisherService,
  ) {}

  private key(marketplaceId: string, accountId?: string | null): string {
    return accountId ? `${marketplaceId}:${accountId}` : marketplaceId;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.MODERATION_RECONCILER_ENABLED === 'false') {
      this.logger.log('[Moderation] reconciler disabled via MODERATION_RECONCILER_ENABLED=false');
      return;
    }
    const marketplaces = await this.registry.findAll();
    // ML-only for now (the only provider). Others join as providers are added.
    for (const mkt of marketplaces.filter((m: any) => m.enabled && m.tag === 'mercadolivre')) {
      const marketplaceId = String(mkt._id);
      const accounts = await this.broker.listAccountsWithToken(marketplaceId);
      const targets = accounts.length ? accounts.map((a) => a.accountId) : [undefined];
      for (const accountId of targets) {
        this.scheduleNext(marketplaceId, RECON.FLOOR_MS, accountId);
      }
    }
  }

  private scheduleNext(marketplaceId: string, delay: number, accountId?: string): void {
    const k = this.key(marketplaceId, accountId);
    this.intervals.set(k, delay);
    const t = setTimeout(
      () =>
        this.runFor(marketplaceId, accountId).catch((e) =>
          this.logger.error(`[Moderation] ${k} failed: ${(e as Error).message}`),
        ),
      delay,
    );
    this.timers.set(k, t);
  }

  async runFor(marketplaceId: string, accountId?: string): Promise<void> {
    const k = this.key(marketplaceId, accountId);

    let token: { accessToken: string; additionalData: Record<string, any> };
    try {
      token = accountId
        ? await this.broker.ensureValidTokenByAccount(marketplaceId, accountId)
        : await this.broker.ensureValidToken(marketplaceId);
    } catch (err) {
      this.logger.warn(`[Moderation] ${k} no token — skipping: ${(err as Error).message}`);
      this.scheduleNext(marketplaceId, RECON.CEILING_MS, accountId);
      return;
    }

    const userId = token.additionalData?.userId;
    if (!userId) {
      this.logger.warn(`[Moderation] ${k} token has no userId — cannot query /infractions`);
      this.scheduleNext(marketplaceId, RECON.CEILING_MS, accountId);
      return;
    }

    const infractions = await this.mlClient.getAllInfractions(token.accessToken, userId);
    const acctKey = accountId ?? null;
    const openRows = await this.repo.findAllOpen(marketplaceId, acctKey);

    // Classify the active infractions to canonical, keyed by externalId.
    const activeById = new Map(
      infractions
        .map((inf) => this.mlProvider.toCanonical(inf))
        .filter((c) => c.externalId)
        .map((c) => [c.externalId, c] as const),
    );

    const { toIngest, toResolve } = diffModerations({
      activeExternalIds: [...activeById.keys()],
      openExternalIds: openRows.map((r) => r.externalId),
    });

    let changes = 0;

    for (const externalId of toIngest) {
      const canonical = activeById.get(externalId)!;
      // Enrich reason/remedy via last_moderation, and the blocked category for wrong-category.
      const last = await this.mlClient.getLastModeration(externalId, token.accessToken);
      const enriched = last ? this.mlProvider.toCanonical(canonical.raw as any, last) : canonical;
      const blockedCategoryId =
        enriched.type === 'WRONG_CATEGORY'
          ? await this.mlClient.getItemCategoryId(externalId, token.accessToken)
          : null;
      const res = await this.ingest.ingest(marketplaceId, acctKey, enriched, blockedCategoryId);
      if (res.outcome === 'handled') changes++;
    }

    const openByExternalId = new Map(openRows.map((r) => [r.externalId, r]));
    for (const externalId of toResolve) {
      const row = openByExternalId.get(externalId);
      if (!row) continue;
      await this.resolve(marketplaceId, acctKey, externalId, String(row._id), String(row.productId ?? ''));
      changes++;
    }

    const cleanRun = changes === 0;
    const current = this.intervals.get(k) ?? RECON.FLOOR_MS;
    const next = nextInterval(current, cleanRun);
    this.logger.log(
      `[Moderation] ${k} active=${activeById.size} open=${openRows.length} ingested=${toIngest.length} resolved=${toResolve.length} nextMs=${next}`,
    );
    this.scheduleNext(marketplaceId, next, accountId);
  }

  /**
   * Close a moderation that disappeared from /infractions: mark state resolved, clear the listing's
   * moderation-driven block, and ask the orchestrator to re-publish.
   */
  private async resolve(
    marketplaceId: string,
    accountId: string | null,
    externalId: string,
    stateId: string,
    productId: string,
  ): Promise<void> {
    await this.repo.markResolved(stateId);

    const listing = await this.listingModel.findOne({ marketplaceId, externalId });
    if (listing) {
      const md = { ...(listing.marketplaceData ?? {}) };
      delete md.syncIssue;
      listing.marketplaceData = md;
      listing.errorMessage = undefined;
      listing.synchronized = true;
      if (listing.status === 'pending_removal' || listing.status === 'error') {
        listing.status = 'active';
      }
      await listing.save();
    }

    if (productId) {
      await this.publisher.requestSync({
        productId,
        reason: 'moderation_resolved',
        resolutionSignal: 'moderation_resolved',
        force: false,
        targetMarketplaceIds: [marketplaceId],
      });
    }

    this.logger.log(`[Moderation] resolved ${externalId} (state ${stateId}) — listing cleared, re-publish requested`);
  }
}
