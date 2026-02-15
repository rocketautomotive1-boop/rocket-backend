
import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ScraperFactory } from './scraper.factory';
import { ProductService } from '../product/product.service';

@Injectable()
export class ScraperService {
    private readonly logger = new Logger(ScraperService.name);

    constructor(
        private scraperFactory: ScraperFactory,
        private productService: ProductService
    ) { }

    async scrapeUrl(url: string, save: boolean = false): Promise<any> {
        this.logger.log(`Starting scrape for URL: ${url}`);

        const strategy = this.scraperFactory.getStrategy(url);
        this.logger.log(`Selected strategy: ${strategy.name}`);

        let browser: Browser;
        try {
            browser = await puppeteer.launch({
                headless: false, // Set to true in prod. False helps debugging.
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                defaultViewport: { width: 1920, height: 1080 }
            });

            const page = await browser.newPage();

            // 1. Login
            await strategy.login(page);

            // 2. Scrape
            // 2. Scrape with incremental saving
            const onProgress = save ? async (items: any[]) => { await this.saveProducts(items); } : undefined;
            const data = await strategy.scrape(page, url, onProgress);

            this.logger.log(`Scraped ${data.length} items.`);

            // 3. Save (if requested)
            if (save && data.length > 0) {
                await this.saveProducts(data);
            }

            return {
                strategy: strategy.name,
                count: data.length,
                data: data
            };

        } catch (error) {
            this.logger.error(`Scraping failed: ${error.message}`, error.stack);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    private async saveProducts(data: any[]) {
        for (const item of data) {
            try {
                // 1. Create or Find (Upsert based on PartNumber)
                const product = await this.productService.create({
                    partNumber: item.partNumber,
                    name: item.name,
                    brand: {
                        name: item.brand?.name || 'Generic',
                        isGenuine: false
                    },
                    barcode: item.ean
                });

                // 2. Update Details (Weight, Dimensions, Description, Brand extended, OemCodes)
                // Note: create() might not update all these if product existed, so we force update.
                await this.productService.update(product._id || (product as any).id, {
                    description: item.description,
                    weight: item.weight,
                    oemCodes: item.oemCodes,
                    applicationSummary: item.applicationSummary,
                    // Ensure brand details are set if they were missing or bare
                    brand: {
                        id: product.brand?._id, // Keep existing ID if any? or let update handle it
                        name: item.brand?.name || product.brand?.name,
                        isGenuine: false
                    }
                    // Dimensions could be parsed from criteria if available, assuming weight is main one for now
                });

                // 3. Update Images
                if (item.images && item.images.length > 0) {
                    await this.productService.updateImages(product._id || (product as any).id, item.images.map(url => ({
                        url: url,
                        key: url, // Use URL as key for now
                        filename: 'scraped-image'
                    })));
                }

                this.logger.log(`Product saved/updated: ${item.partNumber}`);
            } catch (e) {
                this.logger.error(`Failed to save product ${item.partNumber}: ${e.message}`);
            }
        }
    }
}
