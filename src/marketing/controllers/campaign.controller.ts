import { Controller, Get, Post, Body, Param, Delete, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CampaignService } from '../services/campaign.service';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';

@ApiTags('marketing/campaigns')
@Controller('campaigns')
export class CampaignController {
    constructor(private readonly campaignService: CampaignService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new campaign' })
    create(@Body() createCampaignDto: CreateCampaignDto) {
        return this.campaignService.create(createCampaignDto);
    }

    @Get()
    @ApiOperation({ summary: 'List all campaigns' })
    findAll() {
        return this.campaignService.findAll();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get campaign by ID' })
    findOne(@Param('id') id: string) {
        return this.campaignService.findOne(id);
    }

    @Get('slug/:slug/products')
    @ApiOperation({ summary: 'Get products for a campaign' })
    async getCampaignProducts(
        @Param('slug') slug: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 20
    ) {
        return this.campaignService.getCampaignProducts(slug, page, limit);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update a campaign' })
    update(@Param('id') id: string, @Body() updateCampaignDto: UpdateCampaignDto) {
        return this.campaignService.update(id, updateCampaignDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a campaign' })
    remove(@Param('id') id: string) {
        return this.campaignService.remove(id);
    }
}
