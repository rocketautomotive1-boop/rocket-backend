import { Controller, Get, Post, Body, Patch, Param, Delete, Put } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BannerService } from '../services/banner.service';
import { CreateBannerDto } from '../dto/create-banner.dto';
import { UpdateBannerDto } from '../dto/update-banner.dto';
import { SkipJwtAuth } from '../../auth/decorators/skip-jwt-auth.decorator';

@ApiTags('marketing/banners')
@Controller('banners')
export class BannerController {
    constructor(private readonly bannerService: BannerService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new banner' })
    create(@Body() createBannerDto: CreateBannerDto) {
        return this.bannerService.create(createBannerDto);
    }

    @Get()
    @ApiOperation({ summary: 'List all banners (admin)' })
    findAll() {
        return this.bannerService.findAll();
    }

    @SkipJwtAuth()
    @Get('active')
    @ApiOperation({ summary: 'List active banners (storefront)' })
    findActive() {
        return this.bannerService.findActive();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get banner by ID' })
    findOne(@Param('id') id: string) {
        return this.bannerService.findOne(id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update a banner' })
    update(@Param('id') id: string, @Body() updateBannerDto: UpdateBannerDto) {
        return this.bannerService.update(id, updateBannerDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a banner' })
    remove(@Param('id') id: string) {
        return this.bannerService.remove(id);
    }
}
