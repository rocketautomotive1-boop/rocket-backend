import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ListingDocument, ListingModel } from './schemas/listing.schema';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { STORE_PORT, StorePort } from '../store/ports/store.port';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';

@Injectable()
export class ListingService {
    private readonly logger = new Logger(ListingService.name);

    constructor(
        @InjectModel(ListingModel.name)
        public readonly listingModel: Model<ListingDocument>,
        @Inject(STORE_LISTING_PORT)
        private readonly storeListingPort: StoreListingPort,
        @Inject(STORE_PORT)
        private readonly storePort: StorePort,
        private readonly marketplaceConfigCache: MarketplaceConfigCacheService,
    ) { }

    /**
     * Espelha um ListingModel recém-criado/atualizado em StoreListing +
     * MarketplaceListing (Fase 3 — dual-write). Nunca lança: o legado é a
     * fonte de verdade nesta fase; uma falha aqui é logada e ignorada, não
     * propagada ao chamador de create()/update()/createOrUpdate(). Sem
     * storeId (listing pré-migração, caso raro/transitório), não há o que
     * espelhar — pula silenciosamente, não é um erro.
     */
    private async mirrorToStoreListing(listing: Partial<ListingModel> & { _id?: any }): Promise<void> {
        if (!listing.storeId) return;
        try {
            const config = await this.marketplaceConfigCache.getById(String(listing.marketplaceId));
            if (!config) {
                this.logger.error(
                    `[dual-write] marketplace ${listing.marketplaceId} não encontrado no cache — listing ${listing._id} não espelhado.`,
                );
                return;
            }
            const accountId = await this.storePort.resolveAccountId(String(listing.storeId), config.tag);
            if (!accountId) {
                this.logger.error(
                    `[dual-write] loja ${listing.storeId} sem conta configurada para ${config.tag} — listing ${listing._id} não espelhado.`,
                );
                return;
            }
            const storeListing = await this.storeListingPort.createOrGetStoreListing(
                String(listing.productId),
                String(listing.storeId),
            );
            await this.storeListingPort.upsertMarketplaceListing(
                storeListing.id,
                config.tag,
                accountId,
                { externalId: listing.externalId ?? null, status: listing.status as any },
            );
        } catch (err: any) {
            this.logger.error(
                `[dual-write] falha ao espelhar listing ${listing._id} (produto ${listing.productId}, loja ${listing.storeId}): ${err?.message}`,
            );
        }
    }

    async findByProduct(productId: string | Types.ObjectId): Promise<ListingDocument[]> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        return this.listingModel.find({ productId: pId }).exec();
    }

    /**
     * Listings de um produto restritos a UMA loja — usado pela tela de Títulos (Fase 4,
     * isolamento por loja), onde cada loja só pode ver/editar seus próprios anúncios.
     * findByProduct (sem filtro) continua existindo intocado: adapters de marketplace,
     * orchestrator e pricing legitimamente precisam ver listings de todas as lojas.
     */
    async findByProductAndStore(
        productId: string | Types.ObjectId,
        storeId: string | Types.ObjectId,
    ): Promise<ListingDocument[]> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        const sId = typeof storeId === 'string' ? new Types.ObjectId(storeId) : storeId;
        return this.listingModel.find({ productId: pId, storeId: sId }).exec();
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

    /**
     * storeId é IDENTIDADE do listing, não decoração — nunca deve nascer ausente
     * (ver docs/superpowers/specs/2026-08-12-store-as-aggregate-root-design.md).
     * Rejeita a escrita explicitamente em vez de persistir um listing "órfão" que
     * mais tarde exigiria um fallback para adivinhar a loja (a causa raiz do bug de
     * produto publicado sob a conta errada). Resolver a loja é responsabilidade de
     * quem chama, não deste repositório.
     */
    private assertHasStoreId(data: Partial<ListingModel>): void {
        if (!data.storeId) {
            throw new BadRequestException(
                'ListingModel requer storeId — resolva a loja antes de criar o listing (ver ListingService.assertHasStoreId).',
            );
        }
    }

    async create(data: Partial<ListingModel>): Promise<ListingDocument> {
        this.assertHasStoreId(data);
        const doc = await this.listingModel.create(data);
        await this.mirrorToStoreListing(doc);
        return doc;
    }

    async update(id: string, data: Partial<ListingModel>): Promise<ListingDocument> {
        const doc = await this.listingModel.findByIdAndUpdate(id, { $set: data }, { new: true });
        if (doc) await this.mirrorToStoreListing(doc);
        return doc;
    }

    async delete(id: string): Promise<ListingDocument> {
        return this.listingModel.findByIdAndDelete(id);
    }

    async deleteByProduct(productId: string | Types.ObjectId): Promise<any> {
        const pId = typeof productId === 'string' ? new Types.ObjectId(productId) : productId;
        return this.listingModel.deleteMany({ productId: pId });
    }

    async createOrUpdate(data: Partial<ListingModel>): Promise<ListingDocument> {
        this.assertHasStoreId(data);
        let doc: ListingDocument;
        if (data.externalId && data.marketplaceId) {
            doc = await this.listingModel.findOneAndUpdate(
                { marketplaceId: data.marketplaceId, externalId: data.externalId },
                { $set: data },
                { upsert: true, new: true }
            );
        } else {
            doc = await this.listingModel.create(data);
        }
        await this.mirrorToStoreListing(doc);
        return doc;
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
