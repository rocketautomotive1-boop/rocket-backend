/**
 * Canonical moderation model — marketplace-agnostic.
 *
 * A moderation is a FACT reported by the marketplace (e.g. ML /infractions): a published
 * listing violates a policy. Each marketplace speaks its own vocabulary (ML's `filter_subgroup`);
 * a `ModerationProvider` translates that raw vocabulary into this canonical shape so the rest of
 * the backend (ingest, handlers, reconciler) never depends on a single marketplace's API.
 */

export type ModerationType =
  | 'WRONG_CATEGORY'
  | 'MISSING_COMPATIBILITIES'
  | 'PHOTO_QUALITY'
  | 'PRICE_CHANGE'
  | 'CATALOG_REQUIRED'
  | 'DUPLICATE'
  | 'CONTACT_DATA'
  | 'BRAND_PROTECTION'
  | 'CLASSIFICATION'
  | 'PROHIBITED'
  | 'UNKNOWN';

export interface CanonicalSuggestedCategory {
  /** External (marketplace) category id. */
  externalId: string;
  name?: string;
  path?: string;
  domain?: string;
}

/**
 * A classified moderation, normalized from a marketplace's raw infraction payload.
 * This is the evidence that lives in `moderation_state` — NOT in the listing blob.
 */
export interface CanonicalModeration {
  /** Marketplace tag (e.g. 'mercadolivre'). */
  marketplace: string;
  /** Listing id at the marketplace (ML item id). */
  externalId: string;
  type: ModerationType;
  /** Raw marketplace subgroup, kept for audit/forward-compat (e.g. ML 'DOMAIN'). */
  subgroup: string;
  /** Marketplace infraction id, when present — used for idempotency + dedup. */
  infractionId?: string;
  reason?: string;
  remedy?: string;
  suggestedCategories?: CanonicalSuggestedCategory[];
  /** When the marketplace detected the infraction. */
  detectedAt?: Date;
  /** Untouched marketplace payload, for audit. */
  raw?: unknown;
}

/**
 * Per-marketplace translator. ML is the first; Shopee/Amazon/TikTok add their own without
 * touching ingest/handlers/reconciler.
 */
export interface ModerationProvider {
  readonly marketplace: string;
  /** Map a raw marketplace subgroup to the canonical type (pure). */
  classify(subgroup: string): ModerationType;
}
