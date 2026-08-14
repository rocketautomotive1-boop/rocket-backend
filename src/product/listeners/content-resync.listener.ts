// backend/src/product/listeners/content-resync.listener.ts

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { ListingService } from '../../listing/listing.service';
import { ProductReadinessService } from '../services/product-readiness.service';
import {
  PRODUCT_SECTION_EVENTS,
  ProductImagesSavedEvent,
  ProductTitlesSavedEvent,
  ProductCategorySavedEvent,
  ProductDataSavedEvent,
  ProductDimensionsSavedEvent,
} from '../events/product-section-saved.event';

/**
 * Auto re-sync of CONTENT edits on an ALREADY-published product.
 *
 * Publication is a pure function of product state (there is no publish button and no
 * `force`). First publication is driven by `BECAME_READY` (the false→true readiness
 * transition). But editing an already-ready, already-published product does NOT flip
 * readiness — it stays true — so `BECAME_READY` never fires and the marketplace would
 * drift from the product. This listener closes that gap: any content change to a
 * ready+published product schedules a debounced re-sync so the marketplace converges
 * to the current state.
 *
 * Why debounce: a single user edit emits several section-saved events in a burst; we
 * coalesce them into one sync per quiet window instead of one sync per keystroke/save.
 *
 * Why it's safe w.r.t. rembg: the re-sync only fires when `compute().readyToPublish` is
 * true, and a product with an image slot still in rembg `processing` is NOT ready. So a
 * re-sync scheduled mid-processing simply resolves to "not ready → skip"; the eventual
 * `BECAME_READY`/next edit converges it once images are real. Nothing publishes a
 * half-processed image.
 *
 * Operational fields (price/active/stock) are intentionally NOT handled here — they flow
 * through the operational GlobalWatcher path. This listener owns CONTENT only.
 */
@Injectable()
export class ContentResyncListener implements OnModuleDestroy {
  private readonly logger = new Logger(ContentResyncListener.name);

  /** Coalesce a burst of section saves for the same product into a single sync. */
  private static readonly DEBOUNCE_MS = 3000;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly orchestratorPublisher: OrchestratorPublisherService,
    private readonly listingService: ListingService,
    private readonly readiness: ProductReadinessService,
  ) {}

  @OnEvent(PRODUCT_SECTION_EVENTS.IMAGES_SAVED)
  onImages(event: ProductImagesSavedEvent) {
    this.schedule(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.TITLES_SAVED)
  onTitles(event: ProductTitlesSavedEvent) {
    this.schedule(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.CATEGORY_SAVED)
  onCategory(event: ProductCategorySavedEvent) {
    this.schedule(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.DATA_SAVED)
  onData(event: ProductDataSavedEvent) {
    this.schedule(event.productId);
  }

  @OnEvent(PRODUCT_SECTION_EVENTS.DIMENSIONS_SAVED)
  onDimensions(event: ProductDimensionsSavedEvent) {
    this.schedule(event.productId);
  }

  private schedule(productId: string): void {
    const existing = this.timers.get(productId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(productId);
      void this.maybeResync(productId);
    }, ContentResyncListener.DEBOUNCE_MS);

    // Don't keep the event loop alive just for a pending debounce.
    timer.unref?.();
    this.timers.set(productId, timer);
  }

  private async maybeResync(productId: string): Promise<void> {
    try {
      // Only re-sync products that are ALREADY published. First publication is owned by
      // the BECAME_READY path — this listener converges live listings after edits.
      const published = await this.listingService.existsActiveForProduct(productId);
      if (!published) return;

      // Single readiness gate: never re-sync a product that isn't publishable (e.g. an
      // image slot still processing). The orchestrator enforces this too, but skipping
      // here avoids a pointless enqueue.
      const computed = await this.readiness.compute(productId);
      if (!computed?.readyToPublish) return;

      await this.orchestratorPublisher.requestSync({
        productId,
        reason: 'content_edit',
      });
      this.logger.log(`Content re-sync enqueued for product ${productId}`);
    } catch (err) {
      this.logger.error(`Content re-sync failed for product ${productId}: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
