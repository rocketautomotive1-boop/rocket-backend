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
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }> {
    const externalId = options?.externalId ?? null;

    // Duplicata real = mesmo externalId já publicado para este storeListingId+marketplaceTag.
    // Sem externalId (pending_creation), não há o que checar — o índice único parcial também
    // não protege esse caso (decisão explícita: criação é ação deliberada do usuário).
    if (externalId) {
      const existing = await this.marketplaceListingModel
        .findOne({ storeListingId, marketplaceTag, externalId })
        .exec();
      if (existing) {
        throw new BadRequestException(
          `Já existe uma publicação com externalId ${externalId} em ${marketplaceTag} para este StoreListing.`,
        );
      }
    }
    try {
      const doc = await this.marketplaceListingModel.create({
        storeListingId,
        marketplaceTag,
        accountId,
        externalId,
        status: options?.status ?? ('pending_creation' as MarketplaceListingStatus),
      });
      return { ...doc.toObject(), id: String(doc._id) };
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          `Já existe uma publicação com externalId ${externalId} em ${marketplaceTag} para este StoreListing.`,
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

  async createOrGetStoreListing(
    productId: string,
    storeId: string,
  ): Promise<StoreListingModel & { id: string }> {
    const existing = await this.findByProductAndStore(productId, storeId);
    if (existing) return existing;
    return this.create(productId, storeId);
  }

  async upsertMarketplaceListing(
    storeListingId: string,
    marketplaceTag: string,
    accountId: string,
    options?: { externalId?: string | null; status?: MarketplaceListingStatus },
  ): Promise<MarketplaceListingModel & { id: string }> {
    const externalId = options?.externalId ?? null;
    const status = options?.status ?? ('pending_creation' as MarketplaceListingStatus);

    // Mesma lógica de "identidade real" do fix da Fase 2: um marketplace_listing
    // é o mesmo anúncio se (storeListingId, marketplaceTag, externalId) bate —
    // sem externalId (pending_creation), não há como saber se já existe, então
    // sempre cria (mesmo comportamento que createMarketplaceListing já tinha
    // para esse caso).
    const existing = externalId
      ? await this.marketplaceListingModel.findOne({ storeListingId, marketplaceTag, externalId }).exec()
      : null;

    if (existing) {
      const updated = await this.marketplaceListingModel
        .findByIdAndUpdate((existing as any)._id, { $set: { accountId, status } }, { new: true })
        .exec();
      return { ...(updated as any).toObject(), id: String((updated as any)._id) };
    }

    const doc = await this.marketplaceListingModel.create({
      storeListingId,
      marketplaceTag,
      accountId,
      externalId,
      status,
    });
    return { ...doc.toObject(), id: String(doc._id) };
  }
}
