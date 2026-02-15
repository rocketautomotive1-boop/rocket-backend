import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceToken, MarketplaceTokenDocument } from '../schemas/marketplace-token.schema';

@Injectable()
export class MarketplaceRegistryService {
    private readonly logger = new Logger(MarketplaceRegistryService.name);

    constructor(
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceDocument>,
        @InjectModel(MarketplaceToken.name) private tokenModel: Model<MarketplaceTokenDocument>,
    ) { }

    async findAll(): Promise<MarketplaceDocument[]> {
        return this.marketplaceModel.find().exec();
    }

    async findOne(id: string): Promise<MarketplaceDocument> {
        // Validation to prevent CastError
        if (!id || !/^[0-9a-fA-F]{24}$/.test(String(id))) {
            this.logger.warn(`Invalid Marketplace ObjectId: ${id}`);
            return null;
        }

        const marketplace = await this.marketplaceModel.findById(id).exec();

        if (marketplace) {
            // We might want to separate token fetching, but keeping it here for now to match legacy behavior
            const tokens = await this.tokenModel.find({ marketplaceId: marketplace._id as any }).sort({ createdAt: -1 }).exec();
            (marketplace as any).tokens = tokens;
        }

        return marketplace;
    }


    async findByTag(tag: string): Promise<MarketplaceDocument> {
        const marketplace = await this.marketplaceModel.findOne({ tag }).exec();

        if (marketplace) {
            const tokens = await this.tokenModel.find({ marketplaceId: marketplace._id as any }).sort({ createdAt: -1 }).exec();
            (marketplace as any).tokens = tokens;
        }

        return marketplace;
    }

    async findByName(name: string): Promise<MarketplaceDocument> {
        const marketplace = await this.marketplaceModel.findOne({ name }).exec();

        if (marketplace) {
            const tokens = await this.tokenModel.find({ marketplaceId: marketplace._id as any }).sort({ createdAt: -1 }).exec();
            (marketplace as any).tokens = tokens;
        }

        return marketplace;
    }

    async create(data: any): Promise<MarketplaceDocument> {
        const marketplace = new this.marketplaceModel(data);
        return marketplace.save();
    }

    async update(id: string, data: any): Promise<MarketplaceDocument> {
        this.logger.log(`Updating marketplace ${id} with data: ${JSON.stringify(data)}`);

        const marketplace = await this.marketplaceModel.findByIdAndUpdate(id, data, { new: true }).exec();

        if (!marketplace) {
            throw new BadRequestException('Marketplace not found');
        }

        return marketplace;
    }

    async remove(id: string): Promise<void> {
        await this.marketplaceModel.findByIdAndDelete(id).exec();
    }

    async addRequirement(marketplaceId: string, data: any): Promise<any> {
        const marketplace = await this.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        if (!marketplace.requirements) marketplace.requirements = [];
        marketplace.requirements.push(data);
        await marketplace.save();
        return marketplace.requirements[marketplace.requirements.length - 1];
    }

    async updateRequirement(marketplaceId: string, fieldName: string, data: any): Promise<any> {
        const marketplace = await this.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        const index = marketplace.requirements.findIndex((r: any) => r.fieldName === fieldName);
        if (index === -1) throw new BadRequestException('Requirement not found');

        marketplace.requirements[index] = { ...(marketplace.requirements[index] as any).toObject(), ...data };
        await marketplace.save();
        return marketplace.requirements[index];
    }

    async removeRequirement(marketplaceId: string, fieldName: string): Promise<void> {
        const marketplace = await this.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        marketplace.requirements = marketplace.requirements.filter((r: any) => r.fieldName !== fieldName);
        await marketplace.save();
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
