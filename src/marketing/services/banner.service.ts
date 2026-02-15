import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Banner, BannerDocument } from '../schemas/banner.schema';
import { CreateBannerDto } from '../dto/create-banner.dto';
import { UpdateBannerDto } from '../dto/update-banner.dto';

@Injectable()
export class BannerService {
    constructor(
        @InjectModel(Banner.name) private bannerModel: Model<BannerDocument>,
    ) { }

    async create(createBannerDto: CreateBannerDto): Promise<Banner> {
        const createdBanner = new this.bannerModel(createBannerDto);
        return createdBanner.save();
    }

    async findAll(): Promise<Banner[]> {
        return this.bannerModel.find().sort({ position: 1, order: 1 }).exec();
    }

    async findOne(id: string): Promise<Banner> {
        const banner = await this.bannerModel.findById(id).exec();
        if (!banner) {
            throw new NotFoundException(`Banner with ID ${id} not found`);
        }
        return banner;
    }

    async update(id: string, updateBannerDto: UpdateBannerDto): Promise<Banner> {
        const updatedBanner = await this.bannerModel
            .findByIdAndUpdate(id, updateBannerDto, { new: true })
            .exec();
        if (!updatedBanner) {
            throw new NotFoundException(`Banner with ID ${id} not found`);
        }
        return updatedBanner;
    }

    async remove(id: string): Promise<void> {
        const result = await this.bannerModel.findByIdAndDelete(id).exec();
        if (!result) {
            throw new NotFoundException(`Banner with ID ${id} not found`);
        }
    }

    async findActive(): Promise<Banner[]> {
        const now = new Date();
        return this.bannerModel.find({
            active: true,
            $or: [
                { startDate: { $exists: false } },
                { startDate: { $lte: now } },
            ],
            $and: [
                {
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: { $gte: now } },
                    ]
                }
            ]
        }).sort({ position: 1, order: 1 }).exec();
    }
}
