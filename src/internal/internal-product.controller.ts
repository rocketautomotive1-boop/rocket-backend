import { Controller, Get, Param, Patch, Body, UseGuards, Query, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';

@UseGuards(InternalKeyGuard)
@Controller('internal/products')
export class InternalProductController {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        private readonly configCache: MarketplaceConfigCacheService,
        private readonly descriptionService: MarketplaceDescriptionService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    ) {}

    @Get(':id')
    async getProduct(@Param('id') id: string, @Query('marketplaceId') marketplaceId?: string) {
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

        // Stock comes from StockModule (single source of truth). Sale price comes from
        // PricingModule: effectivePrice = per-marketplace override > basePrice (null → no price).
        const [stock, basePrice, effectivePrice] = await Promise.all([
            this.stockQuery.getProductStock(id),
            this.pricing.getBasePrice(id),
            this.pricing.getEffectivePrice(id, marketplaceId),
        ]);

        normalized.stockQuantity = stock.onHand;
        normalized.basePrice = basePrice;
        normalized.effectivePrice = effectivePrice;

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

        const mlId = await this.configCache.resolveId('mercadolivre');
        if (!mlId) return;

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
        const resolved = await Promise.all(marketplaceIds.map((mid) => this.configCache.getById(mid)));
        const tagMap = new Map(
            resolved
                .filter((m): m is NonNullable<typeof m> => !!m)
                .map((m: any) => [String(m._id), m.tag as string]),
        );

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
