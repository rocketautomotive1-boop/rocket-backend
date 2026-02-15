
import { Injectable, NotFoundException } from '@nestjs/common';
import { IScraperStrategy } from './interfaces/scraper-strategy.interface';
import { TecDocStrategy } from './strategies/tecdoc.strategy';

@Injectable()
export class ScraperFactory {
    private strategies: IScraperStrategy[] = [];

    constructor(
        private readonly tecDocStrategy: TecDocStrategy,
    ) {
        this.strategies = [
            this.tecDocStrategy,
        ];
    }

    getStrategy(url: string): IScraperStrategy {
        if (url.includes('tecalliance') || url.includes('tecdoc')) {
            return this.tecDocStrategy;
        }

        // Future strategies...
        // if (url.includes('c123')) return this.c123Strategy;

        throw new NotFoundException(`No scraper strategy found for URL: ${url}`);
    }
}
