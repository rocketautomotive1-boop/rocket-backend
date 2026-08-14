import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModerationHandler, ModerationHandlerContext } from './moderation-handler.interface';
import { ModerationType } from '../providers/moderation-provider.types';
import { NOTIFICATION_EVENTS, NotificationRequested } from '../../notifications/events/notification.events';

/**
 * Missing-compatibilities moderation (ML COMPATS). The listing was paused for not declaring the
 * compatible vehicles. Unlike wrong-category this is recoverable without recreate: we mark the
 * listing's operational syncIssue (retryable) and notify; the evidence lives in moderation_state.
 * No marketplace API call — the orchestrator drives any re-sync via resolution signals.
 */
@Injectable()
export class MissingCompatibilityHandler implements ModerationHandler {
  readonly type: ModerationType = 'MISSING_COMPATIBILITIES';
  private readonly logger = new Logger(MissingCompatibilityHandler.name);

  constructor(private readonly events: EventEmitter2) {}

  async handle(ctx: ModerationHandlerContext): Promise<void> {
    const { listing, canonical, session } = ctx;

    const classifier = String(listing.marketplaceData?.syncIssue?.classifier || '').toUpperCase();
    if (classifier === 'TERMINAL_RECREATE') {
      this.logger.debug(`Listing ${listing._id} already TERMINAL_RECREATE — skipping compatibility override`);
      return;
    }

    const reason = canonical.reason || 'Não indica os veículos compatíveis.';
    const remedy = canonical.remedy || '';
    const at = canonical.detectedAt ?? new Date();

    listing.status = 'error';
    listing.synchronized = false;
    listing.errorMessage = reason;
    listing.lastSyncAt = new Date();
    listing.marketplaceData = {
      ...listing.marketplaceData,
      syncIssue: {
        blocked: true,
        issueKey: 'missing_compatibilities',
        classifier: 'MISSING_COMPATIBILITIES',
        retryable: true,
        requiredResolutionSignals: ['compatibility_sync', 'catalog_change', 'state_recheck', 'user_publish'],
        retryAfterSeconds: 1800,
        reason: 'missing_compatibilities',
        blockedAt: at,
        lastErrorMessage: reason,
        lastAction: 'UPDATE',
      },
    };
    await listing.save({ session });

    this.logger.warn(`[MissingCompat] Listing ${listing._id} (${listing.externalId}) flagged for missing compatibilities`);

    const event: NotificationRequested = {
      type: 'moderation.missing_compatibilities',
      aggregateType: 'moderation',
      aggregateId: String(listing._id),
      deduplicationKey: `moderation:missing_compat:${listing.externalId}`,
      title: 'Anúncio com compatibilidades incompletas',
      body: remedy
        ? `O Mercado Livre pausou o anúncio ${listing.externalId}. ${reason} ${remedy}`
        : `O Mercado Livre pausou o anúncio ${listing.externalId} por não indicar os veículos compatíveis. Adicione as compatibilidades e republique.`,
      severity: 'warning',
      channels: ['push', 'websocket', 'persist'],
      data: {
        type: 'moderation',
        marketplace: canonical.marketplace,
        productId: String(listing.productId),
        listingId: String(listing._id),
        previousExternalId: listing.externalId,
      },
    };
    this.events.emit(NOTIFICATION_EVENTS.REQUESTED, event);
  }
}
