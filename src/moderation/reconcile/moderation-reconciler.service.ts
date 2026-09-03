import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { MlModerationsClient } from '../ml/ml-moderations.client';
import { MercadoLivreModerationProvider } from '../providers/mercadolivre-moderation.provider';
import { ModerationRepository } from '../moderation.repository';
import { ModerationIngestService } from '../ingest/moderation-ingest.service';
import { diffModerations } from './moderation-diff';

/**
 * Moderation reconciliation runs once a day — that cadence is enough. /infractions changes slowly,
 * and the `items` webhook probe already covers low-latency cases between runs.
 */
const RECON = {
  DAILY_MS: 24 * 60 * 60 * 1000,
  /**
   * Cap on how many already-open rows get the extra live getItemModerationStatus check per run.
   * Open-row count scales with account size (seen live: 1600+), not with the once-a-day cadence —
   * without a cap a single run could burst thousands of GET /items/{id} calls and risk ML's rate
   * limit. Rows past the cap simply keep their current state and get re-checked on a later run.
   */
  MAX_STATUS_CHECKS_PER_RUN: 200,
};

/**
 * PRIMARY moderation source of truth. ML has no `moderations` webhook topic — infractions are
 * discovered by polling /infractions. Per (marketplace, account) this fetches active infractions,
 * diffs them against our open moderation_state rows, then:
 *   - ingests the active ones (upsert open + apply handler), and
 *   - RESOLVES rows that vanished from /infractions — closing the state and clearing the listing's
 *     pending_removal/syncIssue, then asking the orchestrator to re-publish. The old polling never
 *     closed anything, so local state diverged and got stuck; this is the fix.
 * Runs once a day — that cadence is enough; the `items` webhook probe covers low-latency cases.
 */
@Injectable()
export class ModerationReconciler implements OnModuleInit {
  private readonly logger = new Logger(ModerationReconciler.name);
  private readonly mlProvider = new MercadoLivreModerationProvider();
  private timers = new Map<string, NodeJS.Timeout>();

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
        // Run once right away — deploys happen more often than the 24h cadence, and this is a
        // plain in-memory timer with no persisted "next run at", so waiting a full day here means
        // a reconciler that restarts before completing a cycle never actually runs in production.
        this.runFor(marketplaceId, accountId).catch((e) =>
          this.logger.error(`[Moderation] ${this.key(marketplaceId, accountId)} failed: ${(e as Error).message}`),
        );
      }
    }
  }

  private scheduleNext(marketplaceId: string, delay: number, accountId?: string): void {
    const k = this.key(marketplaceId, accountId);
    const t = setTimeout(
      () =>
        this.runFor(marketplaceId, accountId).catch((e) =>
          this.logger.error(`[Moderation] ${k} failed: ${(e as Error).message}`),
        ),
      delay,
    );
    this.timers.set(k, t);
  }

  async runFor(
    marketplaceId: string,
    accountId?: string,
    maxStatusChecks: number = RECON.MAX_STATUS_CHECKS_PER_RUN,
  ): Promise<void> {
    const k = this.key(marketplaceId, accountId);

    let token: { accessToken: string; additionalData: Record<string, any> };
    try {
      token = accountId
        ? await this.broker.ensureValidTokenByAccount(marketplaceId, accountId)
        : await this.broker.ensureValidToken(marketplaceId);
    } catch (err) {
      this.logger.warn(`[Moderation] ${k} no token — skipping: ${(err as Error).message}`);
      this.scheduleNext(marketplaceId, RECON.DAILY_MS, accountId);
      return;
    }

    const userId = token.additionalData?.userId;
    if (!userId) {
      this.logger.warn(`[Moderation] ${k} token has no userId — cannot query /infractions`);
      this.scheduleNext(marketplaceId, RECON.DAILY_MS, accountId);
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
    let statusChecksUsed = 0;
    const openByExternalId = new Map(openRows.map((r) => [r.externalId, r]));

    for (const externalId of toIngest) {
      // /infractions is a historical log (per ML's own docs) — it never drops an entry just
      // because the item got fixed. For a row we already have open, trust /items/{id}'s current
      // status/sub_status over the stale infractions listing: if the item is genuinely no longer
      // under moderation, resolve it instead of re-flagging it forever. Capped per run — see
      // RECON.MAX_STATUS_CHECKS_PER_RUN.
      const openRow = openByExternalId.get(externalId);
      if (openRow && statusChecksUsed < maxStatusChecks) {
        statusChecksUsed++;
        const itemStatus = await this.mlClient.getItemModerationStatus(externalId, token.accessToken);
        if (!itemStatus.stillModerated) {
          await this.resolve(marketplaceId, acctKey, externalId, String(openRow._id), String(openRow.productId ?? ''));
          changes++;
          continue;
        }
      }

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

    for (const externalId of toResolve) {
      const row = openByExternalId.get(externalId);
      if (!row) continue;
      await this.resolve(marketplaceId, acctKey, externalId, String(row._id), String(row.productId ?? ''));
      changes++;
    }

    this.logger.log(
      `[Moderation] ${k} active=${activeById.size} open=${openRows.length} ingested=${toIngest.length} resolved=${toResolve.length} changes=${changes} nextMs=${RECON.DAILY_MS}`,
    );
    this.scheduleNext(marketplaceId, RECON.DAILY_MS, accountId);
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

    // marketplaceId stored as ObjectId — cast so the filter actually matches (same pitfall as ingest).
    const listing = await this.listingModel.findOne({
      marketplaceId: Types.ObjectId.isValid(marketplaceId) ? new Types.ObjectId(marketplaceId) : marketplaceId,
      externalId,
    });
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
        targetMarketplaceIds: [marketplaceId],
      });
    }

    this.logger.log(`[Moderation] resolved ${externalId} (state ${stateId}) — listing cleared, re-publish requested`);
  }
}
