// backend/src/marketplace/auth/services/marketplace-account.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MarketplaceAccountModel,
  MarketplaceAccountDocument,
} from '../schemas/marketplace-account.schema';

/**
 * Persistência das contas de marketplace (multi-client).
 * Conexão default — é dado de marketplace/autopeças.
 */
@Injectable()
export class MarketplaceAccountRepository {
  constructor(
    @InjectModel(MarketplaceAccountModel.name)
    private readonly model: Model<MarketplaceAccountDocument>,
  ) {}

  async findDefault(marketplaceId: string): Promise<MarketplaceAccountModel | null> {
    return this.model
      .findOne({ marketplaceId: new Types.ObjectId(marketplaceId), isDefault: true })
      .lean()
      .exec();
  }

  async createDefaultIfAbsent(
    data: Partial<MarketplaceAccountModel>,
  ): Promise<MarketplaceAccountModel | null> {
    const existing = await this.model
      .findOne({ marketplaceId: new Types.ObjectId(data.marketplaceId as unknown as string), isDefault: true })
      .lean()
      .exec();
    if (existing) return null;
    const created = await this.model.create({ ...data, isDefault: true });
    return created.toObject();
  }
}
