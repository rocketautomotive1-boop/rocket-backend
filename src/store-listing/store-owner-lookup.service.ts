import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StoreListingModel, StoreListingDocument } from './schemas/store-listing.schema';
import { StoreOwnerLookupPort } from './ports/store-owner-lookup.port';

@Injectable()
export class StoreOwnerLookupService implements StoreOwnerLookupPort {
    constructor(
        @InjectModel(StoreListingModel.name)
        private readonly storeListingModel: Model<StoreListingDocument>,
    ) { }

    async findStoreIdByProduct(productId: string): Promise<string | null> {
        const doc = await this.storeListingModel.findOne({ productId }).sort({ _id: 1 }).exec();
        return doc ? doc.storeId.toString() : null;
    }
}
