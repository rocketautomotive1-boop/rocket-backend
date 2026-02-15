import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Campaign, CampaignDocument, CampaignType } from '../schemas/campaign.schema';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';
import { SearchService } from '../../search/search.service';

@Injectable()
export class CampaignService {
    constructor(
        @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
        // Assuming SearchService exists and can search products
        private readonly searchService: SearchService,
    ) { }

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

        if (campaign.type === CampaignType.MANUAL_SELECTION) {
            // Fetch products by ID
            return this.searchService.search(null, {
                ids: campaign.productIds,
            });
        } else if (campaign.type === CampaignType.AUTO_QUERY) {
            // Execute Query
            return this.searchService.search(campaign.query);
        }
    }
}
