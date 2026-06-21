import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ModerationStateDocument,
  ModerationStateModel,
} from './schemas/moderation-state.schema';
import { CanonicalModeration } from './providers/moderation-provider.types';

export interface ModerationLinks {
  marketplaceId: string;
  accountId?: string | null;
  listingId?: string;
  productId?: string;
  blockedCategoryId?: string | null;
}

/**
 * Owns reads/writes of the moderation_state collection — the single source of truth for
 * marketplace moderations. Ingest upserts open rows; the reconciler closes rows that vanish
 * from /infractions.
 */
@Injectable()
export class ModerationRepository {
  constructor(
    @InjectModel(ModerationStateModel.name)
    private readonly model: Model<ModerationStateDocument>,
  ) {}

  /**
   * Upsert an OPEN moderation from a canonical infraction. Idempotent on
   * (marketplaceId, accountId, externalId). Re-opens a previously resolved row if the same
   * listing is moderated again.
   */
  async upsertOpen(
    canonical: CanonicalModeration,
    links: ModerationLinks,
  ): Promise<ModerationStateDocument> {
    const accountId = links.accountId ?? null;
    const set: Record<string, unknown> = {
      type: canonical.type,
      subgroup: canonical.subgroup,
      status: 'open',
      infractionId: canonical.infractionId,
      reason: canonical.reason,
      remedy: canonical.remedy,
      suggestedCategories: (canonical.suggestedCategories ?? []).map((c) => ({
        externalId: c.externalId,
        name: c.name,
        path: c.path,
      })),
      blockedCategoryId: links.blockedCategoryId ?? null,
      detectedAt: canonical.detectedAt,
      resolvedAt: null,
    };
    if (links.listingId) set.listingId = new Types.ObjectId(links.listingId);
    if (links.productId) set.productId = new Types.ObjectId(links.productId);

    return this.model
      .findOneAndUpdate(
        {
          marketplaceId: new Types.ObjectId(links.marketplaceId),
          accountId,
          externalId: canonical.externalId,
        },
        { $set: set, $setOnInsert: { removalAttempts: 0, removalLastAttemptAt: null } },
        { new: true, upsert: true },
      )
      .exec();
  }

  /** Open moderations for a set of externalIds within one (marketplace, account). */
  async findOpenByExternalIds(
    marketplaceId: string,
    accountId: string | null,
    externalIds: string[],
  ): Promise<ModerationStateDocument[]> {
    if (!externalIds.length) return [];
    return this.model
      .find({
        marketplaceId: new Types.ObjectId(marketplaceId),
        accountId: accountId ?? null,
        status: 'open',
        externalId: { $in: externalIds },
      })
      .exec();
  }

  /** All open moderations for a (marketplace, account) — used by the reconciler to diff/close. */
  async findAllOpen(
    marketplaceId: string,
    accountId: string | null,
  ): Promise<ModerationStateDocument[]> {
    return this.model
      .find({
        marketplaceId: new Types.ObjectId(marketplaceId),
        accountId: accountId ?? null,
        status: 'open',
      })
      .exec();
  }

  async findOpenByExternalId(
    marketplaceId: string,
    accountId: string | null,
    externalId: string,
  ): Promise<ModerationStateDocument | null> {
    return this.model
      .findOne({
        marketplaceId: new Types.ObjectId(marketplaceId),
        accountId: accountId ?? null,
        status: 'open',
        externalId,
      })
      .exec();
  }

  /** Close a moderation (resolved at the marketplace). Returns the updated row or null. */
  async markResolved(id: string | Types.ObjectId): Promise<ModerationStateDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { $set: { status: 'resolved', resolvedAt: new Date() } }, { new: true })
      .exec();
  }
}
