import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import {
  MarketplaceListingModel,
  MarketplaceListingDocument,
  MarketplaceListingStatus,
} from './schemas/marketplace-listing.schema';
import { StoreListingPort } from './ports/store-listing.port';

@Injectable()
export class StoreListingService implements StoreListingPort {
  constructor(
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
    @InjectModel(MarketplaceListingModel.name)
    private readonly marketplaceListingModel: Model<MarketplaceListingDocument>,
  ) {}

  async create(productId: string, storeId: string): Promise<StoreListingModel & { id: string }> {
    const existing = await this.storeListingModel.findOne({ productId, storeId }).exec();
    if (existing) {
      throw new BadRequestException(
        `Já existe um StoreListing para o produto ${productId} na loja ${storeId}.`,
      );
    }
    try {
      const doc = await this.storeListingModel.create({ productId, storeId });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          `Já existe um StoreListing para o produto ${productId} na loja ${storeId}.`,
        );
      }
      throw err;
    }
  }

  async findByProductAndStore(
    productId: string,
    storeId: string,
  ): Promise<(StoreListingModel & { id: string }) | null> {
    const doc = await this.storeListingModel.findOne({ productId, storeId }).exec();
    if (!doc) return null;
    return { ...((doc as any).toObject?.() ?? doc), id: String((doc as any)._id) };
  }

  async findById(storeListingId: string): Promise<(StoreListingModel & { id: string }) | null> {
    if (!Types.ObjectId.isValid(storeListingId)) return null;
    const doc = await this.storeListingModel.findById(storeListingId).exec();
    if (!doc) return null;
    return { ...((doc as any).toObject?.() ?? doc), id: String((doc as any)._id) };
  }

  async createMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
  ): Promise<MarketplaceListingModel & { id: string }> {
    const existing = await this.marketplaceListingModel.findOne({ storeListingId, marketplaceTag }).exec();
    if (existing) {
      throw new BadRequestException(
        `Já existe uma publicação em ${marketplaceTag} para este StoreListing.`,
      );
    }
    try {
      const doc = await this.marketplaceListingModel.create({
        storeListingId,
        marketplaceTag,
        accountId,
        externalId: null,
        status: 'pending_creation' as MarketplaceListingStatus,
      });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          `Já existe uma publicação em ${marketplaceTag} para este StoreListing.`,
        );
      }
      throw err;
    }
  }

  async getMarketplaceListings(
    storeListingId: string,
  ): Promise<Array<MarketplaceListingModel & { id: string }>> {
    const docs = await this.marketplaceListingModel.find({ storeListingId }).exec();
    return docs.map((doc: any) => ({ ...(doc.toObject?.() ?? doc), id: String(doc._id) }));
  }
}
