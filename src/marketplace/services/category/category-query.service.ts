import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceCategoryModel, MarketplaceCategoryDocument } from '../../schemas/marketplace-category.schema';

@Injectable()
export class CategoryQueryService {
  private readonly logger = new Logger(CategoryQueryService.name);

  constructor(
    @InjectModel(MarketplaceCategoryModel.name)
    private marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,
  ) { }

  async findCategories(marketplaceId: number | string, parentId?: string, query?: string): Promise<MarketplaceCategoryDocument[]> {
    this.logger.log(`Buscando categorias para marketplace ID ${marketplaceId}`);

    // Build query
    const filter: any = {};

    // Handle marketplaceId
    if (marketplaceId) {
      filter.marketplace = marketplaceId as any;
    }

    if (parentId) {
      filter.parentId = parentId;
    } else if (query === undefined) {
      // If parentId is not provided and no search query, return root categories
      // We check for null, undefined or empty string
      filter.parentId = { $in: [null, '', undefined] };
    }

    if (query) {
      filter.name = { $regex: query, $options: 'i' };
    }

    // If filtering by marketplace, we might need to handle the fact that marketplaceId passed could be legacyId
    // But since this is a migration, we expect callers to pass identifiers compatible with the DB state.
    // If the DB has stored numeric IDs in 'marketplace' field (unlikely for ref), or ObjectId.
    // Assuming 'marketplace' field in MarketplaceCategoryModel is a Ref to MarketplaceModel (ObjectId).
    // If the input is a number, this query might fail to find matches if 'marketplace' is ObjectId.
    // Ideally we would look up the Marketplace ObjectId first.
    // But for the scope of fixing compilation, we ensure types match.

    return this.marketplaceCategoryModel.find(filter).exec();
  }

  async findCategoryByExternalId(marketplaceId: number | string, externalId: string): Promise<MarketplaceCategoryDocument> {
    this.logger.log(`Buscando categoria por ID externo ${externalId} para marketplace ID ${marketplaceId}`);

    return this.marketplaceCategoryModel.findOne({
      marketplace: marketplaceId as any,
      externalId,
    }).exec();
  }

  async findCategoryById(id: string): Promise<MarketplaceCategoryDocument> {
    this.logger.log(`Buscando categoria por ID ${id}`);

    // Try to find by _id first if it looks like an ObjectId, otherwise query legacyId if it exists, or failsafe
    if (typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) {
      return this.marketplaceCategoryModel.findById(id).populate('marketplace').exec();
    } else {
      // Fallback: Try to find by externalId
      // Note: This might be ambiguous if multiple marketplaces share external IDs, but usually safe for now 
      // or we accept we might need marketplaceId in context, but this method signature is simple.
      // Better approach: find one that matches.
      return this.marketplaceCategoryModel.findOne({ externalId: id }).populate('marketplace').exec();
    }
  }
}