import { Controller, Get, Param, Patch, Body, UseGuards, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { MarketplaceModel } from '../marketplace/schemas/marketplace.schema';
import { StockMovementModel } from '../product/schemas/stock-movement.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';

@UseGuards(InternalKeyGuard)
@Controller('internal/products')
export class InternalProductController {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        @InjectModel(MarketplaceModel.name) private readonly marketplaceModel: Model<MarketplaceModel>,
        @InjectModel(StockMovementModel.name) private readonly stockMovementModel: Model<StockMovementModel>,
        private readonly descriptionService: MarketplaceDescriptionService,
    ) {}

    @Get(':id')
    async getProduct(@Param('id') id: string) {
        const doc = await this.productModel
            .findById(id)
            .populate('category', '_id name mlCategoryId marketplaceMappings')
            .lean()
            .exec();
        if (!doc) return null;
        const normalized = this.normalizeBson(doc);

        // Resolve o category_id do ML a partir do marketplaceMappings quando o campo
        // direto (mlCategoryId) estiver ausente — itens general têm o mapping do ML
        // (externalId) mas não o mlCategoryId, e o orchestrator só lê mlCategoryId.
        await this.fillMlCategoryId(normalized.category);

        // Compute stock and effective price from stock_movements — product schema has no stockQuantity field
        const [stockResult, priceResult] = await Promise.all([
            this.stockMovementModel.aggregate([
                { $match: { productId: new Types.ObjectId(id) } },
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: {
                                $switch: {
                                    branches: [
                                        { case: { $in: ['$type', ['inbound', 'purchase_return']] }, then: '$quantity' },
                                        { case: { $in: ['$type', ['outbound', 'sale', 'transfer']] }, then: { $multiply: ['$quantity', -1] } },
                                        { case: { $eq: ['$type', 'adjustment'] }, then: '$quantity' },
                                    ],
                                    default: 0,
                                },
                            },
                        },
                    },
                },
            ]).exec(),
            // Most recent inbound price as effective selling price
            (this.stockMovementModel as any)
                .findOne({ productId: new Types.ObjectId(id), type: 'inbound', price: { $exists: true, $ne: null } })
                .sort({ date: -1 })
                .select('price')
                .lean()
                .exec(),
        ]);

        normalized.stockQuantity = stockResult[0]?.total ?? 0;

        // Use movement price only if product has no price set
        if (!normalized.price && priceResult?.price) {
            normalized.price = parseFloat(priceResult.price.toString());
        }

        return normalized;
    }

    private normalizeBson(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        // Decimal128 — has _bsontype or toString that returns the decimal string
        if (obj._bsontype === 'Decimal128' || (obj.bytes && obj._bsontype)) {
            return parseFloat(obj.toString());
        }
        // ObjectId — convert to hex string
        if (obj._bsontype === 'ObjectId' || obj._bsontype === 'ObjectID') {
            return obj.toHexString ? obj.toHexString() : String(obj);
        }
        if (Array.isArray(obj)) return obj.map((item) => this.normalizeBson(item));
        if (typeof obj !== 'object') return obj;
        const out: any = {};
        for (const key of Object.keys(obj)) {
            out[key] = this.normalizeBson(obj[key]);
        }
        return out;
    }

    /**
     * Garante `category.mlCategoryId` preenchido a partir do marketplaceMappings
     * do ML (externalId). Não sobrescreve um mlCategoryId já existente.
     */
    private async fillMlCategoryId(category: any): Promise<void> {
        if (!category || typeof category !== 'object' || category.mlCategoryId) return;
        const mappings = category.marketplaceMappings;
        if (!Array.isArray(mappings) || mappings.length === 0) return;

        const ml = await this.marketplaceModel
            .findOne({ tag: 'mercadolivre' })
            .select('_id')
            .lean()
            .exec();
        if (!ml) return;

        const mlId = String((ml as any)._id);
        const mapping = mappings.find((m: any) => String(m.marketplaceId) === mlId);
        const externalId = mapping?.externalId ?? mapping?.categoryResult?.category_id;
        if (externalId) category.mlCategoryId = String(externalId);
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

    @Get(':id/description/:marketplaceTag')
    async getDescription(
        @Param('id') id: string,
        @Param('marketplaceTag') marketplaceTag: string,
        @Query('listingTitle') listingTitle?: string,
    ) {
        const product = await this.productModel
            .findById(id)
            .populate('category', '_id name mlCategoryId')
            .exec();
        if (!product) return { description: '' };
        try {
            const description = await this.descriptionService.generateDescription(
                product as any,
                marketplaceTag,
                undefined,
                listingTitle,
            );
            return { description };
        } catch {
            return { description: (product as any).description ?? (product as any).details ?? '' };
        }
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
