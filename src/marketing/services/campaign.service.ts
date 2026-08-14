import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Campaign, CampaignDocument, CampaignType } from '../schemas/campaign.schema';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';
import { ProductRepository } from '../../product/product.repository';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';

@Injectable()
export class CampaignService {
    constructor(
        @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
        private readonly productRepository: ProductRepository,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    ) { }

    /**
     * Anota cada produto com price/listPrice (promoção vigente) do PricingModule — a campanha
     * não tem desconto próprio, só agrega produtos que já têm Promotion individual. Ver
     * docs/superpowers/specs/2026-07-13-offers-system-design.md.
     */
    private async attachPricing(products: any[]): Promise<any[]> {
        if (products.length === 0) return products;
        const pricingById = await this.pricing.getPricings(products.map((p) => String(p._id)));
        return products.map((p) => {
            const pr = pricingById.get(String(p._id));
            return { ...p, price: pr?.basePrice ?? 0, listPrice: pr?.listPrice };
        });
    }

    async create(createCampaignDto: CreateCampaignDto): Promise<Campaign> {
        const createdCampaign = new this.campaignModel(createCampaignDto);
        return createdCampaign.save();
    }

    async findAll(): Promise<Campaign[]> {
        return this.campaignModel.find().exec();
    }

    async findOne(id: string): Promise<Campaign> {
        const campaign = await this.campaignModel.findById(id).exec();
        if (!campaign) {
            throw new NotFoundException(`Campaign with ID ${id} not found`);
        }
        return campaign;
    }

    async findBySlug(slug: string): Promise<Campaign> {
        const campaign = await this.campaignModel.findOne({ slug }).exec();
        if (!campaign) {
            throw new NotFoundException(`Campaign with slug ${slug} not found`);
        }
        return campaign;
    }

    async update(id: string, updateCampaignDto: UpdateCampaignDto): Promise<Campaign> {
        const updatedCampaign = await this.campaignModel
            .findByIdAndUpdate(id, updateCampaignDto, { new: true })
            .exec();
        if (!updatedCampaign) {
            throw new NotFoundException(`Campaign with ID ${id} not found`);
        }
        return updatedCampaign;
    }

    async remove(id: string): Promise<void> {
        const result = await this.campaignModel.findByIdAndDelete(id).exec();
        if (!result) {
            throw new NotFoundException(`Campaign with ID ${id} not found`);
        }
    }

    async getCampaignProducts(slug: string, page = 1, limit = 20): Promise<any> {
        const campaign = await this.findBySlug(slug);

        // Product lookup runs on MongoDB (Elasticsearch removido).
        if (campaign.type === CampaignType.MANUAL_SELECTION) {
            // Fetch products by ID
            const data = await this.productRepository.findAllClean(
                { _id: { $in: campaign.productIds || [] }, active: true },
                { page, limit },
            );
            return { data: await this.attachPricing(data) };
        } else if (campaign.type === CampaignType.AUTO_QUERY) {
            // Execute Query (regex sobre nome / partNumber)
            const term = (campaign.query || '').trim();
            const query: any = { active: true };
            if (term) {
                const regex = new RegExp(
                    term.split(/\s+/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
                    'i',
                );
                query.$or = [{ name: regex }, { partNumber: regex }];
            }
            const data = await this.productRepository.findAllClean(query, { page, limit });
            return { data: await this.attachPricing(data) };
        }
    }
}
