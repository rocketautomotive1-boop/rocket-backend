import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';

@Injectable()
export class StoreListingService {
  constructor(
    @InjectModel(StoreListingModel.name)
    private readonly storeListingModel: Model<StoreListingDocument>,
  ) {}

  async create(productId: string, storeId: string): Promise<StoreListingModel & { id: string }> {
    const existing = await this.storeListingModel.findOne({ productId, storeId }).exec();
    if (existing) {
      throw new BadRequestException(
        `Já existe um StoreListing para o produto ${productId} na loja ${storeId}.`,
      );
    }
    const doc = await this.storeListingModel.create({ productId, storeId });
    return { ...doc.toObject(), id: String(doc._id) };
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
}
