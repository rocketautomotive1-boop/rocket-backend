import { ClientSession } from 'mongoose';
import { ListingDocument } from '../../listing/schemas/listing.schema';
import { ProductDocument } from '../../product/schemas/product.schema';
import { ModerationStateDocument } from '../schemas/moderation-state.schema';
import { CanonicalModeration, ModerationType } from '../providers/moderation-provider.types';

/**
 * What a handler receives. The handler is a DETECTOR's effect-applier, not an executor:
 * it persists the operational consequence on the listing/product and the canonical state row,
 * then enqueues a command for the orchestrator to actually act on the marketplace (delete /
 * republish). It never calls the marketplace API directly.
 */
export interface ModerationHandlerContext {
  listing: ListingDocument;
  product: ProductDocument | null;
  /** The just-upserted open moderation_state row (source of truth for evidence). */
  state: ModerationStateDocument;
  canonical: CanonicalModeration;
  /** Optional transaction session — handler writes participate in the ingest transaction. */
  session?: ClientSession;
}

export interface ModerationHandler {
  readonly type: ModerationType;
  handle(ctx: ModerationHandlerContext): Promise<void>;
}
