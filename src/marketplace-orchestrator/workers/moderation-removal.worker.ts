import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { ListingRemovalService } from '../services/listing-removal.service';

const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [5, 15, 60];
const POLL_MS = 60 * 1000;

/**
 * Deletes listings marked `pending_removal` (by wrong-category moderation). ML doesn't let you edit
 * a wrong-category listing, so the finalized listing must be removed before the user can re-publish
 * under the corrected category.
 *
 * Lives in the orchestrator (alongside ListingRemovalService) on purpose: moderation is the DETECTOR
 * and only marks `pending_removal`; the actual marketplace DELETE is EXECUTION, owned here. This
 * keeps the module boundary acyclic (orchestrator → moderation only, never the reverse).
 *
 * It does NOT re-publish — that happens only when the user fixes the category
 * (marketplace-issues.resolveSignal('category_change')).
 */
@Injectable()
export class ModerationRemovalWorker {
  private readonly logger = new Logger(ModerationRemovalWorker.name);

  constructor(
    @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    private readonly removal: ListingRemovalService,
  ) {}

  @Interval(POLL_MS)
  async run(): Promise<void> {
    if (process.env.MODERATION_REMOVAL_ENABLED === 'false') return;

    const pending = await this.listingModel
      .find({ status: 'pending_removal', externalId: { $type: 'string' } })
      .exec();
    if (!pending.length) return;

    for (const listing of pending) {
      const md = listing.marketplaceData ?? {};
      const attempts = Number(md.removal_attempts ?? 0);
      const lastAttempt: Date | null = md.removal_last_attempt_at ?? null;

      // Exponential backoff between attempts.
      if (lastAttempt && attempts > 0) {
        const backoffMs = (BACKOFF_MINUTES[attempts - 1] ?? 60) * 60 * 1000;
        if (Date.now() - new Date(lastAttempt).getTime() < backoffMs) continue;
      }

      try {
        // Delegates to the marketplace (DELETE job via RabbitMQ). The result handler clears
        // externalId when it returns; we only bump bookkeeping here. moderationDelete:true
        // marks the origin so SyncResultConsumer can leave the listing eligible to re-enter a
        // future sync once the product is ready again (a MANUAL delete never should).
        await this.removal.removeListing(String(listing._id), undefined, { moderationDelete: true });
        await this.bump(listing, attempts + 1, false);
        this.logger.log(`[ModerationRemoval] dispatched delete for listing ${listing._id} (${listing.externalId})`);
      } catch (err) {
        const next = attempts + 1;
        const exhausted = next >= MAX_ATTEMPTS;
        await this.bump(listing, next, exhausted);
        if (exhausted) {
          this.logger.error(`[ModerationRemoval] exhausted for listing ${listing._id}: ${(err as Error).message}`);
        } else {
          this.logger.warn(`[ModerationRemoval] failed (attempt ${next}/${MAX_ATTEMPTS}) for ${listing._id}: ${(err as Error).message}`);
        }
      }
    }
  }

  private async bump(listing: ListingDocument, attempts: number, exhausted: boolean): Promise<void> {
    const set: Record<string, unknown> = {
      'marketplaceData.removal_attempts': attempts,
      'marketplaceData.removal_last_attempt_at': new Date(),
    };
    if (exhausted) set.status = 'removal_failed';
    await this.listingModel.updateOne({ _id: listing._id }, { $set: set }).exec();
  }
}
