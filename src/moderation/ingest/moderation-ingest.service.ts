import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingDocument, ListingModel } from '../../listing/schemas/listing.schema';
import { ProductDocument, ProductModel } from '../../product/schemas/product.schema';
import { ModerationRepository } from '../moderation.repository';
import { ModerationHandlerRegistry } from '../handlers/moderation-handler.registry';
import { CanonicalModeration } from '../providers/moderation-provider.types';

export interface IngestResult {
  outcome: 'handled' | 'no_listing' | 'no_handler';
  externalId: string;
}

/**
 * Single ingest path shared by the webhook trigger and the reconciler. Given a classified
 * canonical moderation + its account context, it resolves the local listing/product, upserts the
 * moderation_state row (source of truth for evidence), and runs the matching handler. The handler
 * applies the operational consequence and emits a command — ingest itself touches no marketplace API.
 */
@Injectable()
export class ModerationIngestService {
  private readonly logger = new Logger(ModerationIngestService.name);

  constructor(
    @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    private readonly repo: ModerationRepository,
    private readonly handlers: ModerationHandlerRegistry,
  ) {}

  /**
   * @param marketplaceId internal marketplace id
   * @param accountId multi-client account (null = default)
   * @param canonical the classified moderation
   * @param blockedCategoryId optional pre-resolved blocked category (wrong-category)
   */
  async ingest(
    marketplaceId: string,
    accountId: string | null,
    canonical: CanonicalModeration,
    blockedCategoryId?: string | null,
  ): Promise<IngestResult> {
    const externalId = canonical.externalId;

    const listing = await this.listingModel.findOne({
      marketplaceId,
      externalId,
      status: { $ne: 'removed' },
    });
    if (!listing) {
      this.logger.debug(`No local listing for externalId ${externalId} — skipping`);
      return { outcome: 'no_listing', externalId };
    }

    const handler = this.handlers.get(canonical.type);
    if (!handler) {
      this.logger.debug(`No handler for moderation type ${canonical.type} (${externalId}) — skipping`);
      return { outcome: 'no_handler', externalId };
    }

    const product = await this.productModel.findById(listing.productId);

    const state = await this.repo.upsertOpen(canonical, {
      marketplaceId,
      accountId,
      listingId: String(listing._id),
      productId: String(listing.productId),
      blockedCategoryId: blockedCategoryId ?? null,
    });

    await handler.handle({ listing, product, state, canonical });

    this.logger.log(`Handled ${canonical.type} for listing ${listing._id} (externalId ${externalId})`);
    return { outcome: 'handled', externalId };
  }
}
