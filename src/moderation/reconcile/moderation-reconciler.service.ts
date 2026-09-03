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

/**
 * Moderation reconciliation runs once a day — that cadence is enough. /infractions changes slowly,
 * and the `items` webhook probe already covers low-latency cases between runs.
 */
const RECON = {
  DAILY_MS: 24 * 60 * 60 * 1000,
};

/**
 * PRIMARY moderation source of truth. ML has no `moderations` webhook topic — infractions are
 * discovered by polling /infractions, but /infractions is a historical log that NEVER expires an
 * entry (confirmed against ML's own docs and live data) — it is a discovery mechanism only, never
 * a signal that something is still open. Per (marketplace, account) this:
 *   1. discovers candidate externalIds from /infractions (still the only way to find NEW ones),
 *   2. unions them with every currently-open moderation_state row (a row can still be open locally
 *      even if it dropped out of /infractions, or vice versa — both need the same real check),
 *   3. batch-checks EVERY candidate's real current status via /items multiget (no cap — batching
 *      is what makes covering the whole set per run affordable; a 1700-infraction account is ~85
 *      calls instead of up to 1700 sequential ones),
 *   4. ingests candidates that are genuinely still moderated, resolves open rows that aren't, and
 *      no-ops on brand-new candidates that are already resolved (never create-then-immediately-
 *      resolve a row).
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

  async runFor(marketplaceId: string, accountId?: string): Promise<void> {
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
    const openByExternalId = new Map(openRows.map((r) => [r.externalId, r]));

    // Classify the discovered infractions to canonical, keyed by externalId.
    const activeById = new Map(
      infractions
        .map((inf) => this.mlProvider.toCanonical(inf))
        .filter((c) => c.externalId)
        .map((c) => [c.externalId, c] as const),
    );

    // /infractions never expires an entry (per ML's docs), so it's a discovery mechanism only —
    // the union with currently-open rows is the full set of candidates that need a REAL status
    // check this run. No cap: the batch multiget makes checking everyone affordable.
    const candidateIds = new Set([...activeById.keys(), ...openByExternalId.keys()]);
    const statusById = await this.mlClient.getItemsModerationStatus([...candidateIds], token.accessToken);

    let ingested = 0;
    let resolved = 0;

    for (const externalId of candidateIds) {
      const itemStatus = statusById.get(externalId);
      const openRow = openByExternalId.get(externalId);

      if (itemStatus?.stillModerated) {
        const canonical = activeById.get(externalId);
        if (!canonical) continue; // open locally but no longer in /infractions AND still moderated — nothing new to ingest, leave as-is
        // Enrich reason/remedy via last_moderation, and the blocked category for wrong-category.
        const last = await this.mlClient.getLastModeration(externalId, token.accessToken);
        const enriched = last ? this.mlProvider.toCanonical(canonical.raw as any, last) : canonical;
        const blockedCategoryId =
          enriched.type === 'WRONG_CATEGORY'
            ? await this.mlClient.getItemCategoryId(externalId, token.accessToken)
            : null;
        const res = await this.ingest.ingest(marketplaceId, acctKey, enriched, blockedCategoryId);
        if (res.outcome === 'handled') ingested++;
      } else if (openRow) {
        // Genuinely no longer moderated AND we have a row to close — resolve it. A brand-new
        // candidate that's already resolved (no openRow) is a no-op: never create then resolve.
        await this.resolve(marketplaceId, acctKey, externalId, String(openRow._id), String(openRow.productId ?? ''));
        resolved++;
      }
    }

    this.logger.log(
      `[Moderation] ${k} candidates=${candidateIds.size} open=${openRows.length} ingested=${ingested} resolved=${resolved} nextMs=${RECON.DAILY_MS}`,
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
