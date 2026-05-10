import { Controller, Get, Param, Patch, Body, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { MarketplaceModel } from '../marketplace/schemas/marketplace.schema';

@UseGuards(InternalKeyGuard)
@Controller('internal/products')
export class InternalProductController {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        @InjectModel(MarketplaceModel.name) private readonly marketplaceModel: Model<MarketplaceModel>,
    ) {}

    @Get(':id')
    async getProduct(@Param('id') id: string) {
        const doc = await this.productModel
            .findById(id)
            .populate('category', '_id name mlCategoryId')
            .lean()
            .exec();
        if (!doc) return null;
        return this.normalizeDecimals(doc);
    }

    private normalizeDecimals(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== 'object') return obj;
        if (obj.$numberDecimal !== undefined) return parseFloat(obj.$numberDecimal);
        if (Array.isArray(obj)) return obj.map((item) => this.normalizeDecimals(item));
        const out: any = {};
        for (const key of Object.keys(obj)) {
            out[key] = this.normalizeDecimals(obj[key]);
        }
        return out;
    }

    @Get(':id/listings')
    async getListings(@Param('id') id: string) {
        const listings = await this.listingModel
            .find({ productId: new Types.ObjectId(id), status: { $ne: 'removed' } })
            .lean()
            .exec();

        const marketplaceIds = [...new Set(listings.map((l) => String(l.marketplaceId)))];
        const marketplaces = await this.marketplaceModel
            .find({ _id: { $in: marketplaceIds } })
            .select('_id tag')
            .lean()
            .exec();
        const tagMap = new Map(marketplaces.map((m: any) => [String(m._id), m.tag as string]));

        return listings.map((l) => ({
            ...l,
            marketplaceTag: tagMap.get(String(l.marketplaceId)) ?? '',
        }));
    }

    @Patch(':id/warnings/resolve')
    async resolveWarning(
        @Param('id') id: string,
        @Body() body: { type: string; externalId: string },
    ) {
        await this.productModel.findByIdAndUpdate(id, {
            $pull: { warnings: { type: body.type, externalId: body.externalId } },
        });
        return { resolved: true };
    }
}
