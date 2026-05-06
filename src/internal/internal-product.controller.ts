import { Controller, Get, Param, Patch, Body, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';

@UseGuards(InternalKeyGuard)
@Controller('internal/products')
export class InternalProductController {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
    ) {}

    @Get(':id')
    async getProduct(@Param('id') id: string) {
        return this.productModel
            .findById(id)
            .populate('category', '_id name mlCategoryId')
            .lean()
            .exec();
    }

    @Get(':id/listings')
    async getListings(@Param('id') id: string) {
        return this.listingModel
            .find({ productId: new Types.ObjectId(id), status: { $ne: 'removed' } })
            .lean()
            .exec();
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
