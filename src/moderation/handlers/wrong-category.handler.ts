import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModerationHandler, ModerationHandlerContext } from './moderation-handler.interface';
import { ModerationType } from '../providers/moderation-provider.types';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { ProductWarning } from '../../product/schemas/product.schema';
import { NOTIFICATION_EVENTS, NotificationRequested } from '../../notifications/events/notification.events';

/**
 * Wrong-category moderation (ML DOMAIN). The marketplace finalized the listing because it was in
 * the wrong category. We:
 *  - mark the listing pending_removal with a terminal recreate syncIssue (operational consequence
 *    only — the EVIDENCE lives in moderation_state, not in the listing blob);
 *  - unset the product category + add a single warning (domain decision);
 *  - emit a sync command so the ORCHESTRATOR removes the listing and recreates it. Moderation
 *    detects; the orchestrator executes — we never call the ML API from here.
 */
@Injectable()
export class WrongCategoryHandler implements ModerationHandler {
  readonly type: ModerationType = 'WRONG_CATEGORY';
  private readonly logger = new Logger(WrongCategoryHandler.name);

  constructor(
    private readonly publisher: OrchestratorPublisherService,
    private readonly events: EventEmitter2,
  ) {}

  async handle(ctx: ModerationHandlerContext): Promise<void> {
    const { listing, product, state, canonical, session } = ctx;

    if (listing.status === 'pending_removal' || listing.status === 'removed') {
      this.logger.debug(`Listing ${listing._id} already ${listing.status} — skipping wrong-category`);
      return;
    }

    const externalId = listing.externalId;
    const reason = canonical.reason || 'Estava em uma categoria incorreta.';
    const remedy = canonical.remedy || '';

    // Listing keeps ONLY the operational consequence: status + a terminal syncIssue contract that
    // the orchestrator understands. No reason/remedy/categories here — those are in moderation_state.
    listing.status = 'pending_removal';
    listing.errorMessage = reason;
    listing.synchronized = false;
    listing.publishingAt = null;
    listing.lastSyncAt = new Date();
    listing.marketplaceData = {
      ...listing.marketplaceData,
      syncIssue: {
        blocked: true,
        issueKey: 'terminal_recreate_required',
        classifier: 'TERMINAL_RECREATE',
        retryable: false,
        requiredResolutionSignals: ['catalog_change', 'category_change', 'user_publish'],
        reason: 'terminal_recreate_required',
        blockedAt: canonical.detectedAt ?? new Date(),
        lastErrorMessage: reason,
        lastAction: 'UPDATE',
      },
    };
    await listing.save({ session });

    // Domain decision on the product: drop the wrong category + record a single warning.
    if (product) {
      const warnings: ProductWarning[] = Array.isArray(product.warnings) ? product.warnings : [];
      const alreadyWarned = warnings.some(
        (w) => w.type === 'WRONG_CATEGORY' && w.externalId === externalId,
      );
      if (!alreadyWarned) {
        const warning: ProductWarning = {
          type: 'WRONG_CATEGORY',
          message: `Categoria incorreta detectada pelo Mercado Livre. ${remedy || 'Corrija a categoria e republique.'}`,
          marketplaceTag: canonical.marketplace,
          externalId,
          originalCategoryId: state.blockedCategoryId || undefined,
          suggestedCategoryIds: (canonical.suggestedCategories ?? []).map((c) => c.externalId),
          createdAt: canonical.detectedAt ?? new Date(),
        };
        await product.updateOne(
          { $unset: { category: '' }, $push: { warnings: warning } },
          { session },
        );
      }
    }

    this.logger.warn(
      `[WrongCategory] Listing ${listing._id} pending_removal (externalId: ${externalId}); product ${product?._id} category dropped`,
    );

    // Command (transactional via outbox): orchestrator removes + recreates the listing.
    await this.publisher.requestSync(
      {
        productId: String(listing.productId),
        reason: 'moderation_wrong_category',
        resolutionSignal: 'category_change',
        force: true,
        targetMarketplaceIds: [String(listing.marketplaceId)],
      },
      session,
    );

    this.emitNotification(externalId, reason, remedy, ctx);
  }

  private emitNotification(
    externalId: string | undefined,
    reason: string,
    remedy: string,
    ctx: ModerationHandlerContext,
  ): void {
    const event: NotificationRequested = {
      type: 'moderation.wrong_category',
      aggregateType: 'moderation',
      aggregateId: String(ctx.listing._id),
      deduplicationKey: `moderation:wrong_category:${externalId}`,
      title: 'Anúncio finalizado — Categoria incorreta',
      body: remedy
        ? `O Mercado Livre finalizou o anúncio ${externalId}. ${reason} ${remedy}`
        : `O Mercado Livre finalizou o anúncio ${externalId} por estar em uma categoria incorreta. Corrija a categoria e republique.`,
      severity: 'warning',
      channels: ['push', 'websocket', 'persist'],
      data: {
        type: 'moderation',
        marketplace: ctx.canonical.marketplace,
        productId: String(ctx.listing.productId),
        listingId: String(ctx.listing._id),
        previousExternalId: externalId,
      },
    };
    this.events.emit(NOTIFICATION_EVENTS.REQUESTED, event);
  }
}
