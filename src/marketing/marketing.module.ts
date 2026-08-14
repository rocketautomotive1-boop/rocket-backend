import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Banner, BannerSchema } from './schemas/banner.schema';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import { BannerService } from './services/banner.service';
import { CampaignService } from './services/campaign.service';
import { BannerController } from './controllers/banner.controller';
import { CampaignController } from './controllers/campaign.controller';
import { ProductModule } from '../product/product.module'; // ProductRepository for campaign product lookup
import { PricingModule } from '../pricing/pricing.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Banner.name, schema: BannerSchema },
            { name: Campaign.name, schema: CampaignSchema },
        ]),
        ProductModule,
        PricingModule,
    ],
    controllers: [BannerController, CampaignController],
    providers: [BannerService, CampaignService],
    exports: [BannerService, CampaignService],
})
export class MarketingModule { }
