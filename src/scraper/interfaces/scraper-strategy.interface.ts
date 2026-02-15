
import { Page } from 'puppeteer';

export interface IScraperStrategy {
    /**
     * Defines the name of the strategy (e.g. 'tecdoc', 'c123')
     */
    name: string;

    /**
     * Performs authentication if necessary.
     * Should check if session is already active to avoid redundant logins.
     * @param page Puppeteer Page instance
     */
    login(page: Page): Promise<void>;

    /**
     * Main method to scrape data from a given URL.
     * Handles navigation, list traversal, pagination, and detail extraction.
     * @param page Puppeteer Page instance
     * @param url The starting URL (e.g. a search result or category page)
     * @returns A list of scraped data objects (generic for now, can be specific DTOs)
     */
    scrape(page: Page, url: string, onProgress?: (items: any[]) => Promise<void>): Promise<any[]>;
}
