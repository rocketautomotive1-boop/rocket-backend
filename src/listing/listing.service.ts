import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ListingDocument, ListingModel } from './schemas/listing.schema';

@Injectable()
export class ListingService {
    private readonly logger = new Logger(ListingService.name);

    constructor(
        @InjectModel(ListingModel.name)
        public readonly listingModel: Model<ListingDocument>,
    ) { }

    async findByProduct(productId: string | Types.ObjectId): Promise<ListingDocument[]> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        return this.listingModel.find({ productId: pId }).exec();
    }

    async findActiveByProduct(productId: string | Types.ObjectId): Promise<ListingDocument[]> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        return this.listingModel.find({ productId: pId, status: 'active' }).exec();
    }

    async findByMarketplaceId(marketplaceId: string | Types.ObjectId): Promise<ListingDocument[]> {
        return this.listingModel.find({ marketplaceId }).exec();
    }

    /** O listing de um produto num marketplace, para uma loja específica (identidade real pós storeId). */
    async findByProductMarketplaceAndStore(
        productId: string | Types.ObjectId,
        marketplaceId: string | Types.ObjectId,
        storeId: string | Types.ObjectId,
    ): Promise<ListingDocument | null> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        const sId = typeof storeId === 'string' ? new Types.ObjectId(storeId) : storeId;
        return this.listingModel.findOne({ productId: pId, marketplaceId, storeId: sId }).exec();
    }

    async findById(id: string): Promise<ListingDocument> {
        return this.listingModel.findById(id).exec();
    }

    async findOne(query: any): Promise<ListingDocument> {
        return this.listingModel.findOne(query).exec();
    }

    async create(data: Partial<ListingModel>): Promise<ListingDocument> {
        return this.listingModel.create(data);
    }

    async update(id: string, data: Partial<ListingModel>): Promise<ListingDocument> {
        return this.listingModel.findByIdAndUpdate(id, { $set: data }, { new: true });
    }

    async delete(id: string): Promise<ListingDocument> {
        return this.listingModel.findByIdAndDelete(id);
    }

    async deleteByProduct(productId: string | Types.ObjectId): Promise<any> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        return this.listingModel.deleteMany({ productId: pId });
    }

    async createOrUpdate(data: Partial<ListingModel>): Promise<ListingDocument> {
        if (data.externalId && data.marketplaceId) {
            return this.listingModel.findOneAndUpdate(
                { marketplaceId: data.marketplaceId, externalId: data.externalId },
                { $set: data },
                { upsert: true, new: true }
            );
        }
        return this.listingModel.create(data);
    }

    async updateStatus(listingId: string, status: string, errorMessage?: string) {
        return this.listingModel.findByIdAndUpdate(listingId, {
            status,
            errorMessage,
            lastSyncAt: new Date()
        });
    }

    async existsActiveForProduct(productId: string): Promise<boolean> {
        const count = await this.listingModel.countDocuments({
            productId: new Types.ObjectId(productId),
            status: 'active',
        }).exec();
        return count > 0;
    }
}
