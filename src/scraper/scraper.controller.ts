
import { Controller, Post, Body, Query, BadRequestException } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';

@Controller('scraper')
@ApiTags('Scraper')
export class ScraperController {
    constructor(private readonly scraperService: ScraperService) { }

    @Post('extract')
    @ApiOperation({ summary: 'Extract data from a URL without saving' })
    @ApiBody({ schema: { type: 'object', properties: { url: { type: 'string' } } } })
    async extract(@Body('url') url: string) {
        if (!url) throw new BadRequestException('URL is required');
        return this.scraperService.scrapeUrl(url, false);
    }

    @Post('save')
    @ApiOperation({ summary: 'Extract and save data from a URL' })
    @ApiBody({ schema: { type: 'object', properties: { url: { type: 'string' } } } })
    async save(@Body('url') url: string) {
        if (!url) throw new BadRequestException('URL is required');
        return this.scraperService.scrapeUrl(url, true);
    }
}
