import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ModerationType } from '../providers/moderation-provider.types';

export type ModerationStateDocument = HydratedDocument<ModerationStateModel>;

export type ModerationStatus = 'open' | 'resolved';

export interface ModerationSuggestedCategory {
  externalId: string;
  name?: string;
  path?: string;
}

/**
 * Single source of truth for a marketplace moderation (ML infraction). One row per
 * `(marketplaceId, accountId, externalId)`. Owns the EVIDENCE — reason, remedy, suggested
 * categories, infraction id — that used to be scattered across ~17 ad-hoc keys inside
 * `listing.marketplaceData`. The listing keeps only the operational consequence
 * (`status` + `syncIssue`); the explanation is read from here by joining on `externalId`.
 *
 * Lifecycle: `open` when detected in /infractions; `resolved` when it disappears from
 * /infractions (the reconciler closes it — the divergence the old polling never handled).
 */
@Schema({ collection: 'moderation_states', timestamps: true })
export class ModerationStateModel {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MarketplaceModel', required: true, index: true })
  marketplaceId: Types.ObjectId;

  /** Multi-client account; null = default/single-client. */
  @Prop({ type: String, default: null })
  accountId?: string | null;

  /** Listing id at the marketplace (ML item id). */
  @Prop({ type: String, required: true })
  externalId: string;

  @Prop({ type: Types.ObjectId, ref: 'ListingModel', index: true })
  listingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductModel', index: true })
  productId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  type: ModerationType;

  /** Raw marketplace subgroup, kept for audit/forward-compat. */
  @Prop({ type: String })
  subgroup?: string;

  @Prop({ type: String, enum: ['open', 'resolved'], default: 'open', index: true })
  status: ModerationStatus;

  @Prop({ type: String })
  infractionId?: string;

  @Prop({ type: String })
  reason?: string;

  @Prop({ type: String })
  remedy?: string;

  @Prop({ type: [Object], default: [] })
  suggestedCategories?: ModerationSuggestedCategory[];

  /** External category id the listing was blocked in (wrong-category). */
  @Prop({ type: String, default: null })
  blockedCategoryId?: string | null;

  @Prop({ type: Date })
  detectedAt?: Date;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  /** Removal bookkeeping for terminal (recreate-required) moderations. */
  @Prop({ type: Number, default: 0 })
  removalAttempts?: number;

  @Prop({ type: Date, default: null })
  removalLastAttemptAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ModerationStateSchema = SchemaFactory.createForClass(ModerationStateModel);

// One moderation row per listing-at-account. Upserts key on this triple.
ModerationStateSchema.index(
  { marketplaceId: 1, accountId: 1, externalId: 1 },
  { unique: true },
);
// Reconciler scans open rows per (marketplace, account) to diff against /infractions.
ModerationStateSchema.index({ marketplaceId: 1, accountId: 1, status: 1 });
