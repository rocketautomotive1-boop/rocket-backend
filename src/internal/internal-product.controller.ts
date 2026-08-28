import { Controller, Get, Param, Patch, Body, UseGuards, Query, Inject, forwardRef } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InternalKeyGuard } from './internal-key.guard';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import { ProductModel } from '../product/schemas/product.schema';
import { ListingModel } from '../listing/schemas/listing.schema';
import { UserModel } from '../auth/schemas/user.schema';
import { MarketplaceDescriptionService } from '../marketplace/services/marketplace-description.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';
import { CategorySnapshotService } from '../product/services/category-snapshot.service';
import { ProductService } from '../product/product.service';
import { ProductCompatibilityPositionService } from '../product/services/product-compatibility-position.service';
import { StoreService } from '../store/services/store.service';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';

// Piloto Fase 2 (catalog listing): só category_id do ML já validados ao vivo como
// portadores de POSITION/SIDE_POSITION no catálogo de peças (GET /categories/{id}/attributes).
// Ver docs/superpowers/specs/2026-07-15-ml-catalog-listing-publish-design.md.
const CATALOG_LISTING_PILOT_ML_CATEGORY_IDS = new Set<string>([
    'MLB22709', // Amortecedores (Peças de Carros e Caminhonetes > Suspensão e Direção) — domain MLB-VEHICLE_SHOCK_ABSORBERS
]);

@SkipJwtAuth()
@UseGuards(InternalKeyGuard)
@SkipThrottle()
@Controller('internal/products')
export class InternalProductController {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
        private readonly configCache: MarketplaceConfigCacheService,
        private readonly descriptionService: MarketplaceDescriptionService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
        private readonly categorySnapshot: CategorySnapshotService,
        @Inject(forwardRef(() => ProductService)) private readonly productService: ProductService,
        private readonly compatibilityPosition: ProductCompatibilityPositionService,
        private readonly storeService: StoreService,
        @Inject(STORE_LISTING_PORT) private readonly storeListing: StoreListingPort,
    ) {}

    @Get(':id')
    async getProduct(
        @Param('id') id: string,
        @Query('marketplaceId') marketplaceId?: string,
        @Query('storeId') storeId?: string,
    ) {
        const doc = await this.productModel
            .findById(id)
            .populate('category', '_id name mlCategoryId marketplaceMappings')
            .lean()
            .exec();
        if (!doc) return null;
        const normalized = this.normalizeBson(doc);

        // Fonte ÚNICA de prontidão: computa AO VIVO (mesma via que o frontend usa em
        // GET /products/:id/completion). O campo `readyToPublish` persistido no doc é
        // apenas um marker interno do ProductReadinessService para detectar a transição
        // false→true e é volátil (defasa quando o estado muda por um caminho assíncrono
        // sem evento — ex.: rembg concluindo). O gate de publicação NUNCA deve ler o
        // persistido; deriva da mesma verdade que o app mostra ao usuário.
        //
        // storeId: opcional (orchestrator ainda pode chamar sem, listings pré-storeId) —
        // quando informado (loja do listing sendo publicado), o gate é exatamente dessa
        // loja, sem fallback. Sem storeId, cai no fallback já existente do
        // ProductReadinessService (primeira loja com StoreListing).
        const completion = await this.productService.getProductCompletion(id, storeId);
        normalized.readyToPublish = !!completion?.readyToPublish;
        // Gate alternativo pro orchestrator-ms usar em resync de listing JÁ PUBLICADO
        // (action=UPDATE — tem externalId): estoque zerar não deve travar atualização de
        // preço/conteúdo em um anúncio que já está no ar, só a CRIAÇÃO de um listing novo
        // exige estoque > 0. AND de todo componente de completion exceto inventory.
        normalized.readyToPublishExcludingStock = !!(
          completion &&
          completion.data &&
          completion.images &&
          completion.titles &&
          completion.category &&
          completion.dimensions
        );

        // Resolve o category_id do ML a partir do marketplaceMappings quando o campo
        // direto (mlCategoryId) estiver ausente — itens general têm o mapping do ML
        // (externalId) mas não o mlCategoryId, e o orchestrator só lê mlCategoryId.
        await this.fillMlCategoryId(normalized.category);

        // Stock: com storeId, o saldo é DESSA loja (StoreListing — Fase 4), nunca o agregado
        // entre lojas — um produto com estoque multi-loja (1 unidade em cada uma de N lojas)
        // não pode publicar a soma no anúncio de uma loja só. Sem storeId (chamada legada,
        // listing pré-storeId), cai no agregado do StockModule como antes.
        // Sale price vem do PricingModule: effectivePrice = per-marketplace override > basePrice
        // (null → no price).
        const [stockOnHand, basePrice, effectivePrice] = await Promise.all([
            storeId
                ? this.storeListing.getStockSummary(id, storeId).then((s) => s.onHand)
                : this.stockQuery.getProductStock(id).then((s) => s.onHand),
            this.pricing.getBasePrice(id),
            this.pricing.getEffectivePrice(id, marketplaceId),
        ]);

        normalized.stockQuantity = stockOnHand;
        normalized.basePrice = basePrice;
        normalized.effectivePrice = effectivePrice;

        // Payload canônico de publicação ML — fonte única de verdade dos atributos
        // (incl. obrigatórios). O orchestrator publica isto sem remontar. Só resolve
        // quando o request é para o marketplace do ML (o worker sempre passa marketplaceId).
        if (marketplaceId) {
            const mlId = await this.configCache.resolveId('mercadolivre');
            if (mlId && String(marketplaceId) === mlId) {
                normalized.mlPublish = await this.categorySnapshot.resolveMlPublish(id, mlId);
            }
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

        const mlId = await this.configCache.resolveId('mercadolivre');
        if (!mlId) return;

        const mapping = mappings.find((m: any) => String(m.marketplaceId) === mlId);
        const externalId = mapping?.externalId ?? mapping?.categoryResult?.category_id;
        if (externalId) category.mlCategoryId = String(externalId);
    }

    @Get(':id/listings')
    async getListings(@Param('id') id: string) {
        let listings = await this.listingModel
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

        const decided = await this.maybeDecideCatalogListing(id, listings, tagMap);
        if (decided.length) {
            const decidedById = new Map(decided.map((d) => [String(d._id), d.catalogListing]));
            listings = listings.map((l) =>
                decidedById.has(String(l._id)) ? { ...l, catalogListing: decidedById.get(String(l._id)) } : l,
            );
        }

        // storeId é a IDENTIDADE do listing (snapshot gravado na criação — ver
        // ProductTitleService.updateTitles). Backfill concluído (2026-08-28: 100%
        // dos listings em produção têm storeId gravado) — o fallback abaixo cobre
        // só o caso residual de um listing futuro criado sem storeId. Ordem de
        // sinais — ver docs/superpowers/specs/2026-08-14-publish-account-routing-fallback-design.md:
        //   1. listing.storeId (já gravado)
        //   2. listing.marketplaceData.userId → user.storeId (quem de fato publicou)
        //   3. nenhum sinal resolve → null explícito (nunca cai numa loja "padrão")
        const listingsWithAccount = await Promise.all(
            listings.map(async (l) => {
                const tag = tagMap.get(String(l.marketplaceId)) ?? '';
                const storeId = (l as any).storeId
                    ? String((l as any).storeId)
                    : await this.resolveFallbackStoreId((l as any).marketplaceData?.userId ?? null);
                const accountId = await this.storeService.resolveAccountId(storeId, tag);
                return { ...l, marketplaceTag: tag, storeId, accountId };
            }),
        );

        return listingsWithAccount;
    }

    /**
     * storeId de quem de fato publicou o listing (marketplaceData.userId) — usado
     * só quando o listing ainda não tem storeId gravado. Sinal não resolvendo,
     * retorna null explícito: não há fallback para uma loja padrão.
     */
    private async resolveFallbackStoreId(operatorUserId: string | null): Promise<string | null> {
        if (!operatorUserId) return null;
        const operator = await this.userModel.findById(operatorUserId).select('storeId').lean().exec();
        return (operator as any)?.storeId ?? null;
    }

    /**
     * Fase 2 (catalog listing): para listings de ML ainda sem externalId (CREATE pendente)
     * e sem catalogListing gravado, decide (lazy, uma vez) se o produto é elegível a
     * publicar via catalog listing e persiste a decisão no listing. Restrito ao piloto
     * (CATALOG_LISTING_PILOT_ML_CATEGORY_IDS). Nunca lança — falha vira log, listing segue
     * como item comum (comportamento atual). Ver
     * docs/superpowers/specs/2026-07-15-ml-catalog-listing-publish-design.md.
     */
    private async maybeDecideCatalogListing(
        productId: string,
        listings: any[],
        tagMap: Map<string, string>,
    ): Promise<Array<{ _id: any; catalogListing: any }>> {
        const candidates = listings.filter(
            (l) => !l.externalId && !l.catalogListing && tagMap.get(String(l.marketplaceId)) === 'mercadolivre',
        );
        if (!candidates.length) return [];

        try {
            const product = await this.productModel
                .findById(productId)
                .populate('category', '_id mlCategoryId marketplaceMappings')
                .lean()
                .exec();
            const category: any = (product as any)?.category;
            await this.fillMlCategoryId(category);
            const mlCategoryId = category?.mlCategoryId ? String(category.mlCategoryId) : null;
            if (!mlCategoryId || !CATALOG_LISTING_PILOT_ML_CATEGORY_IDS.has(mlCategoryId)) return [];

            const eligibility = await this.compatibilityPosition.computeCatalogEligibility(productId);
            if (!eligibility.eligible || !eligibility.catalogProductId) return [];

            const catalogListing = {
                enabled: true,
                catalogProductId: eligibility.catalogProductId,
                decidedAt: new Date(),
            };

            await Promise.all(
                candidates.map((l) =>
                    this.listingModel.updateOne({ _id: l._id, catalogListing: { $exists: false } }, { $set: { catalogListing } }),
                ),
            );

            return candidates.map((l) => ({ _id: l._id, catalogListing }));
        } catch (err: any) {
            // Nunca derruba o endpoint de leitura — segue sem catalogListing (item comum).
            return [];
        }
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
