import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceConfigCacheService } from './marketplace-config-cache.service';

@Injectable()
export class MarketplaceRegistryService {
    private readonly logger = new Logger(MarketplaceRegistryService.name);

    constructor(
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceDocument>,
        private readonly cache: MarketplaceConfigCacheService,
    ) { }

    /**
     * Leituras servem da camada de cache de config (POJOs congelados, sem token).
     * NÃO use o retorno destes métodos para mutar+`.save()` — os métodos de
     * escrita abaixo buscam o doc mongoose vivo direto do model.
     */
    async findAll(): Promise<MarketplaceDocument[]> {
        return (await this.cache.getAll()) as unknown as MarketplaceDocument[];
    }

    /**
     * Resolve marketplace for API routes that may receive a MongoDB id or a legacy numeric ref
     * (ex.: cliente enviando `1` no sync direto de compatibilidades com ML).
     */
    async resolveMarketplace(ref: string): Promise<MarketplaceDocument | null> {
        const s = String(ref ?? '').trim();
        if (!s) return null;
        if (/^[0-9a-fA-F]{24}$/.test(s)) {
            return this.findOne(s);
        }
        if (/^\d+$/.test(s)) {
            this.logger.warn(
                `Marketplace ref "${s}" is not a MongoDB ObjectId; using Mercado Livre for compatibility sync`,
            );
            return this.findByName('Mercado Livre');
        }
        return null;
    }

    async findOne(id: string): Promise<MarketplaceDocument> {
        // Validation to prevent CastError
        if (!id || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            this.logger.warn(`Invalid Marketplace ObjectId: ${id}`);
            return null;
        }

        // Token/credenciais vêm embarcados no próprio doc (marketplaces.accounts[]).
        // Servido do cache de config (sem token volátil); leitura de token tem
        // caminho próprio ao vivo no TokenBrokerService.
        return (await this.cache.getById(id)) as unknown as MarketplaceDocument;
    }


    async findByTag(tag: string): Promise<MarketplaceDocument> {
        return (await this.cache.getByTag(tag)) as unknown as MarketplaceDocument;
    }

    async findByName(name: string): Promise<MarketplaceDocument> {
        return (await this.cache.getByName(name)) as unknown as MarketplaceDocument;
    }

    /** Doc mongoose VIVO (não cacheado) — para os caminhos de escrita que mutam+salvam. */
    private async findLiveOrThrow(id: string): Promise<MarketplaceDocument> {
        const marketplace = await this.marketplaceModel.findById(id).exec();
        if (!marketplace) throw new BadRequestException('Marketplace not found');
        return marketplace;
    }

    async create(data: any): Promise<MarketplaceDocument> {
        const marketplace = new this.marketplaceModel(data);
        const saved = await marketplace.save();
        this.cache.invalidate();
        return saved;
    }

    async update(id: string, data: any): Promise<MarketplaceDocument> {
        this.logger.log(`Updating marketplace ${id} with data: ${JSON.stringify(data)}`);

        const marketplace = await this.marketplaceModel.findByIdAndUpdate(id, data, { new: true }).exec();

        if (!marketplace) {
            throw new BadRequestException('Marketplace not found');
        }

        this.cache.invalidate();
        return marketplace;
    }

    async remove(id: string): Promise<void> {
        await this.marketplaceModel.findByIdAndDelete(id).exec();
        this.cache.invalidate();
    }

    async addRequirement(marketplaceId: string, data: any): Promise<any> {
        const marketplace = await this.findLiveOrThrow(marketplaceId);

        if (!marketplace.requirements) marketplace.requirements = [];
        marketplace.requirements.push(data);
        await marketplace.save();
        this.cache.invalidate();
        return marketplace.requirements[marketplace.requirements.length - 1];
    }

    async updateRequirement(marketplaceId: string, fieldName: string, data: any): Promise<any> {
        const marketplace = await this.findLiveOrThrow(marketplaceId);

        const index = marketplace.requirements.findIndex((r: any) => r.fieldName === fieldName);
        if (index === -1) throw new BadRequestException('Requirement not found');

        marketplace.requirements[index] = { ...(marketplace.requirements[index] as any).toObject(), ...data };
        await marketplace.save();
        this.cache.invalidate();
        return marketplace.requirements[index];
    }

    async removeRequirement(marketplaceId: string, fieldName: string): Promise<void> {
        const marketplace = await this.findLiveOrThrow(marketplaceId);

        marketplace.requirements = marketplace.requirements.filter((r: any) => r.fieldName !== fieldName);
        await marketplace.save();
        this.cache.invalidate();
    }

    async getRequirements(marketplaceId: string): Promise<any[]> {
        const marketplace = await this.findOne(marketplaceId);
        return marketplace?.requirements || [];
    }

    async getMarketplaceName(marketplaceId: string): Promise<string> {
        const marketplace = await this.findOne(marketplaceId);
        return marketplace?.name || 'Unknown';
    }

    async detectMarketplaceByOrderId(orderId: string): Promise<MarketplaceDocument | null> {
        this.logger.log(`Detecting marketplace for order ID: ${orderId}`);

        // Amazon format: 000-0000000-0000000
        if (/^\d{3}-\d{7}-\d{7}$/.test(orderId)) {
            return this.findByName('Amazon');
        }

        // Mercado Livre format: usually just numeric (e.g. 2000003508419999)
        if (/^\d+$/.test(orderId) && orderId.length > 15) {
            return this.findByName('Mercado Livre');
        }

        // Shopee format: alphanumeric, no hyphens, usually starts with 2 (e.g. 210609U4J8W8W8)
        if (/^[A-Z0-9]{10,}$/.test(orderId) && !orderId.includes('-')) {
            return this.findByName('Shopee');
        }

        return null;
    }
}
