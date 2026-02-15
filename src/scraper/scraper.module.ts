
import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { ScraperFactory } from './scraper.factory';
import { TecDocStrategy } from './strategies/tecdoc.strategy';
import { ProductModule } from '../product/product.module'; // Assuming integration with ProductModule

@Module({
    imports: [ProductModule],
    controllers: [ScraperController],
    providers: [
        ScraperService,
        ScraperFactory,
        TecDocStrategy,
    ],
    exports: [ScraperService],
})
export class ScraperModule { }
