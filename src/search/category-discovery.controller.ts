import { Controller, Get, Query, Post } from '@nestjs/common';
import { CategoryDiscoveryService } from './category-discovery.service';

@Controller('discovery/categories')
export class CategoryDiscoveryController {
    constructor(private readonly discoveryService: CategoryDiscoveryService) { }

    @Get()
    async discover(@Query('q') query: string) {
        if (!query) return { error: 'Query parameter "q" is required' };
        return await this.discoveryService.discover(query);
    }

    @Post('sync')
    async sync() {
        await this.discoveryService.indexAllCategories();
        return { message: 'Synchronization started' };
    }

    @Post('recreate')
    async recreate() {
        return await this.discoveryService.recreateIndex();
    }
}
