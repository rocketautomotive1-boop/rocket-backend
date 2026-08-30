import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModerationHandler, ModerationHandlerContext } from './moderation-handler.interface';
import { ModerationType } from '../providers/moderation-provider.types';
import { ProductWarning } from '../../product/schemas/product.schema';
import { NOTIFICATION_EVENTS, NotificationRequested } from '../../notifications/events/notification.events';
import { TitleCategoryHintService } from '../../product/services/title-category-hint.service';
import { PRODUCT_SECTION_EVENTS, ProductCategorySavedEvent } from '../../product/events/product-section-saved.event';

/**
 * Wrong-category moderation (ML DOMAIN). The marketplace finalized the listing because it was in the
 * wrong category. ML does NOT allow editing a listing while its category is wrong, so the flow is:
 *  - unset the product category + add a single warning (domain decision: user must pick a new one);
 *  - mark the listing pending_removal so the (already-finalized) listing is deleted from ML — the
 *    EVIDENCE lives in moderation_state, the listing keeps only status + syncIssue.
 * It does NOT re-publish: that waits for the user to fix the category (resolveSignal). Moderation
 * detects + blocks; it never calls the ML API.
 */
@Injectable()
export class WrongCategoryHandler implements ModerationHandler {
  readonly type: ModerationType = 'WRONG_CATEGORY';
  private readonly logger = new Logger(WrongCategoryHandler.name);

  constructor(
    private readonly events: EventEmitter2,
    private readonly titleCategoryHintService: TitleCategoryHintService,
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

    // O ML comprovou que este titleId->categoria estava errado — invalida o hint pra não
    // reforçar o mesmo erro no próximo produto com o mesmo shortTitle (ver TitleCategoryHintService).
    if (product?.titleId && product?.category) {
      this.titleCategoryHintService
        .invalidateHint(String(product.titleId), String(product.category))
        .catch((e) =>
          this.logger.warn(`Falha ao invalidar title-category hint para produto ${product._id}: ${e?.message}`),
        );
    }

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

        // O $unset acima é uma escrita direta no Mongo — não passa por
        // ProductReadinessService, então completion.readyToPublish fica obsoleto (ainda
        // true, de antes da moderação). Sem isso, quando o usuário corrigir a categoria
        // depois, refreshAndMaybeEmit vai comparar o recálculo contra esse previousReady
        // travado em true e NUNCA disparar BECAME_READY (a borda exige false→true) — o
        // produto nunca reenfileira sozinho. Emitir o mesmo evento que a edição normal de
        // categoria já usa força o recálculo (e a correção do marcador) agora mesmo.
        this.events.emit(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED, new ProductCategorySavedEvent(String(product._id)));
      }
    }

    this.logger.warn(
      `[WrongCategory] Listing ${listing._id} pending_removal (externalId: ${externalId}); product ${product?._id} category dropped`,
    );

    // NO re-publish here. ML doesn't allow editing a listing whose category is wrong, so the flow is:
    // delete the (already-finalized) listing → WAIT for the user to fix the category → only then
    // re-publish. The delete is driven by `pending_removal` (RemovalWorker); the re-publish is driven
    // by the user correcting the category (marketplace-issues.resolveSignal('category_change')).
    // Emitting requestSync now would re-publish a product with NO category → ML failure or a repeat
    // of the same wrong category, re-entering moderation.

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
