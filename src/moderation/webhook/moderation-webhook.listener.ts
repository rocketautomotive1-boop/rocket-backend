import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import { MlModerationsClient } from '../ml/ml-moderations.client';
import { MercadoLivreModerationProvider } from '../providers/mercadolivre-moderation.provider';
import { ModerationIngestService } from '../ingest/moderation-ingest.service';
import {
  WEBHOOK_DOMAIN_COMMANDS,
  ModerationProbeRequestedCommand,
} from '../../webhook/events/webhook.events';

/**
 * Low-latency trigger. ML has no `moderations` webhook topic, so an `items` webhook is the only
 * real-time hint that a listing may have been moderated. This listener probes /infractions for the
 * single item and, if there's an active infraction, feeds it through the SAME ingest path the
 * reconciler uses. No infraction → cheap no-op. The reconciler remains the source of truth.
 */
@Injectable()
export class ModerationWebhookListener {
  private readonly logger = new Logger(ModerationWebhookListener.name);
  private readonly mlProvider = new MercadoLivreModerationProvider();

  constructor(
    private readonly registry: MarketplaceRegistryService,
    private readonly broker: MarketplaceTokenBrokerService,
    private readonly mlClient: MlModerationsClient,
    private readonly ingest: ModerationIngestService,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.MODERATION_PROBE_REQUESTED)
  async onProbe(cmd: ModerationProbeRequestedCommand): Promise<void> {
    if (cmd.marketplace !== 'mercadolivre' || !cmd.externalId) return;

    const mkt = await this.registry.findByTag('mercadolivre').catch(() => null);
    if (!mkt) return;
    const marketplaceId = String(mkt._id);

    // Resolve the destination account from the seller user_id in the webhook (multi-client).
    let accountId: string | null = null;
    let accessToken: string;
    let userId: string | number | undefined;
    try {
      if (cmd.externalUserId) {
        const ref = await this.broker.resolveAccountByExternalUserId(marketplaceId, cmd.externalUserId);
        accountId = ref?.accountId ?? null;
      }
      const token = accountId
        ? await this.broker.ensureValidTokenByAccount(marketplaceId, accountId)
        : await this.broker.ensureValidToken(marketplaceId);
      accessToken = token.accessToken;
      userId = token.additionalData?.userId;
    } catch (err) {
      this.logger.warn(`[Moderation] probe ${cmd.externalId}: no token — ${(err as Error).message}`);
      return;
    }
    if (!userId) return;

    // Authoritative check: is THIS item among the seller's active infractions?
    const infractions = await this.mlClient.getAllInfractions(accessToken, userId);
    const match = infractions.find((inf) => {
      const id = String(inf.element_id || inf.related_item_id || '');
      return id === cmd.externalId;
    });
    if (!match) {
      this.logger.debug(`[Moderation] probe ${cmd.externalId}: no active infraction — no-op`);
      return;
    }

    const last = await this.mlClient.getLastModeration(cmd.externalId, accessToken);
    const canonical = this.mlProvider.toCanonical(match, last);
    const blockedCategoryId =
      canonical.type === 'WRONG_CATEGORY'
        ? await this.mlClient.getItemCategoryId(cmd.externalId, accessToken)
        : null;

    await this.ingest.ingest(marketplaceId, accountId, canonical, blockedCategoryId);
    this.logger.log(`[Moderation] probe ${cmd.externalId}: ingested ${canonical.type}`);
  }
}
