import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IMarketplaceDiscoveryAdapter, RawDiscoveryData } from '../../interfaces/discovery.interface';
import { AiService } from '../../../ai/ai.service';

@Injectable()
export class GoogleSerpDiscoveryAdapter implements IMarketplaceDiscoveryAdapter {
    private readonly logger = new Logger(GoogleSerpDiscoveryAdapter.name);
    private readonly baseUrl = 'https://google.serper.dev';

    // Pricing rules per instructions
    private readonly EXCHANGE_RATE = 5.50; // Hardcoded exchange rate USD -> BRL (Example)
    private readonly IMPORT_TAX_RATE = 0.60; // 60% Import Tax
    private readonly ICMS_RATE = 0.17; // 17% ICMS
    private readonly COURIER_FEE_BRL = 50.00; // Flat courier fee in BRL

    constructor(
        private readonly config: ConfigService,
        @Inject(forwardRef(() => AiService)) private readonly aiService: AiService
    ) { }

    async search(query: string): Promise<RawDiscoveryData> {
        const apiKey = this.config.get<string>('SERPER_API_KEY');
        if (!apiKey) {
            throw new Error('SERPER_API_KEY not configured in .env');
        }

        // Otimizar query: site:mercadolivre.com.br "{partNumber} {brand}"
        const organicQuery = `site:mercadolivre.com.br ${query}`;
        this.logger.log(`Searching Google via Serper (Organic): ${organicQuery}`);

        try {
            // Organic only
            const [organicRes] = await Promise.allSettled([
                axios.post(
                    `${this.baseUrl}/search`,
                    {
                        q: organicQuery,
                        gl: 'br',
                        hl: 'pt-br',
                        num: 15,
                    },
                    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
                )
            ]);

            const organicItems = organicRes.status === 'fulfilled' ? (organicRes.value.data.organic || []) : [];

            this.logger.log(`Found ${organicItems.length} organic results`);

            // Map Organic Results
            const mappedOrganic = organicItems.map((r: any) => ({
                id: r.link,
                title: r.title,
                price: this.extractPriceFromSnippet(r.snippet) || 0,
                currency_id: 'BRL',
                link: r.link,
                snippet: r.snippet,
                attributes: [],
                type: 'organic'
            }));

            // Helper: extract price from ML listing HTML (handles /up/ catalog pages and standard listings)
            const extractPriceFromML = (htmlRaw: string): number | null => {
                // 1. Schema.org microdata: <meta itemprop="price" content="3347.53">
                //    ML renders this inside span[itemtype="http://schema.org/Offer"]
                const microdataMatch = htmlRaw.match(/<meta[^>]+itemprop="price"[^>]+content="([\d.]+)"/i)
                    || htmlRaw.match(/<meta[^>]+content="([\d.]+)"[^>]+itemprop="price"/i);
                if (microdataMatch) {
                    const price = parseFloat(microdataMatch[1]);
                    if (price > 0) return price;
                }

                // 2. Standard JSON-LD Product offers.price
                const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
                let match;
                while ((match = jsonLdRegex.exec(htmlRaw)) !== null) {
                    try {
                        const json = JSON.parse(match[1]);
                        const graph: any[] = json['@graph'] || [json];
                        for (const node of graph) {
                            const offers = node.offers;
                            if (offers) {
                                const offerList = Array.isArray(offers) ? offers : [offers];
                                for (const offer of offerList) {
                                    const p = parseFloat(offer.price);
                                    if (p > 0) return p;
                                }
                            }
                        }
                    } catch (e) { /* ignore malformed JSON-LD */ }
                }

                // 3. ML /up/ and hydration pages: "amount":69,"currency_id":"BRL" or reverse order
                const amountFwdMatch = htmlRaw.match(/"amount"\s*:\s*(\d+(?:\.\d+)?)\s*,[^}]{0,80}"currency_id"\s*:\s*"BRL"/);
                if (amountFwdMatch) {
                    const price = parseFloat(amountFwdMatch[1]);
                    if (price > 0) return price;
                }
                const amountRevMatch = htmlRaw.match(/"currency_id"\s*:\s*"BRL"[^}]{0,80},\s*"amount"\s*:\s*(\d+(?:\.\d+)?)/);
                if (amountRevMatch) {
                    const price = parseFloat(amountRevMatch[1]);
                    if (price > 0) return price;
                }

                // 4. ML internal fraction/cents format: "fraction":36,"cents":90 → 36.90
                const fractionMatch = htmlRaw.match(/"fraction"\s*:\s*(\d+)[^}]{0,60}"cents"\s*:\s*(\d+)/);
                if (fractionMatch) {
                    const price = parseFloat(`${fractionMatch[1]}.${String(fractionMatch[2]).padStart(2, '0')}`);
                    if (price > 0) return price;
                }

                // 5. Open Graph price meta tag (og:price:amount)
                const ogMatch = htmlRaw.match(/<meta[^>]+property="og:price:amount"[^>]+content="([^"]+)"/i)
                    || htmlRaw.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:price:amount"/i);
                if (ogMatch) {
                    const price = parseFloat(ogMatch[1].replace(',', '.'));
                    if (price > 0) return price;
                }

                return null;
            };

            // Helper: extract breadcrumbs from HTML
            const extractBreadcrumbs = (htmlRaw: string) => {
                let extracted: string[] = [];
                const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
                let sMatch;
                while ((sMatch = jsonLdRegex.exec(htmlRaw)) !== null) {
                    if (sMatch[1].includes('BreadcrumbList')) {
                        try {
                            const json = JSON.parse(sMatch[1]);
                            const graph = json['@graph'] || [json];
                            const list = graph.find((g: any) => g['@type'] === 'BreadcrumbList');
                            if (list && list.itemListElement) {
                                extracted = list.itemListElement.map((i: any) => i.item?.name || i.name);
                                if (extracted.length > 0) return extracted;
                            }
                        } catch (e) { }
                    }
                }
                const linksRegex = /<a[^>]*class="[^"]*andes-breadcrumb__link[^"]*"[^>]*>(.*?)<\/a>/g;
                let lMatch;
                while ((lMatch = linksRegex.exec(htmlRaw)) !== null) {
                    extracted.push(lMatch[1].replace(/<[^>]+>/g, '').trim());
                }
                return extracted;
            };

            // Fetch and extract category path + real price for first 8 items
            const itemsToScrape = mappedOrganic.slice(0, 8);
            // Mark items beyond scrape limit as isActive unknown
            mappedOrganic.slice(8).forEach((item: any) => { item.isActive = null; });

            await Promise.allSettled(itemsToScrape.map(async (item: any) => {
                // lista.mercadolivre.com.br = ML search/category results page.
                // Price was already extracted from the Google snippet — trust it; no need to scrape a listing page.
                if (item.link.includes('lista.mercadolivre.com.br')) {
                    item.isActive = item.price > 0;
                    return;
                }

                // Skip non-ML links entirely
                if (!item.link.includes('mercadolivre.com.br') && !item.link.includes('produto.mercadolivre.com.br')) {
                    item.isActive = null;
                    return;
                }
                try {
                    const { data: html } = await axios.get(item.link, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                        timeout: 5000
                    });

                    // Extract breadcrumbs
                    const breadcrumbs = extractBreadcrumbs(html);
                    if (breadcrumbs.length > 0) {
                        item.category_path = breadcrumbs.join(' > ');
                    }

                    // Extract real price from JSON-LD
                    const realPrice = extractPriceFromML(html);
                    if (realPrice && realPrice > 0) {
                        item.price = realPrice;
                        item.isActive = true;
                    } else {
                        // Page loaded but no price → listing may be paused/unavailable
                        item.isActive = false;
                    }
                } catch (err: any) {
                    // Try to parse from error-page HTML (ML often returns 404 but still renders content)
                    if (err.response && err.response.data) {
                        const errHtml = err.response.data;
                        const breadcrumbs = extractBreadcrumbs(errHtml);
                        if (breadcrumbs.length > 0) {
                            item.category_path = breadcrumbs.join(' > ');
                        }
                        const realPrice = extractPriceFromML(errHtml);
                        if (realPrice && realPrice > 0) {
                            item.price = realPrice;
                            item.isActive = true;
                        } else {
                            item.isActive = false;
                        }
                    } else {
                        item.isActive = null; // Network error — unknown status
                    }
                    this.logger.debug(`Failed to scrape ${item.link}: ${err.message}`);
                }
            }));

            let combinedResults = [...mappedOrganic];

            // Calculate relevance score based on query words
            const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
            const getRelevanceScore = (item: any) => {
                if (queryWords.length === 0) return 1; // Default if query is somehow empty
                const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
                return queryWords.filter(word => text.includes(word)).length;
            };

            const nationalRelevantCount = combinedResults.filter(item => getRelevanceScore(item) > 0).length;

            // If we have very few relevant national results, try an international fallback
            if (nationalRelevantCount < 3) {
                this.logger.log(`Only ${nationalRelevantCount} relevant national results found. Attempting international fallback...`);
                const internationalResults = await this.searchInternationalFallback(query, apiKey);
                combinedResults = [...combinedResults, ...internationalResults];
            }

            // Sort by relevance score to prioritize results that actually contain the query terms
            if (queryWords.length > 0) {
                combinedResults.sort((a, b) => getRelevanceScore(b) - getRelevanceScore(a));
            }

            // Slice to top 20 to avoid massive payloads if both searches yield many results
            combinedResults = combinedResults.slice(0, 20);

            return {
                items: combinedResults
            };

        } catch (error) {
            this.logger.error(`Error calling Serper API: ${error.message}`);
            throw error;
        }
    }

    private async searchInternationalFallback(query: string, apiKey: string): Promise<any[]> {
        const internationalQuery = query; // Just the raw query
        this.logger.log(`Searching Google via Serper (International): ${internationalQuery}`);

        try {
            const [organicRes] = await Promise.allSettled([
                axios.post(
                    `${this.baseUrl}/search`,
                    {
                        q: internationalQuery,
                        gl: 'us', // United States
                        hl: 'en', // English
                        num: 10,
                    },
                    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
                )
            ]);

            const organicItems = organicRes.status === 'fulfilled' ? (organicRes.value.data.organic || []) : [];

            this.logger.log(`Found ${organicItems.length} intl organic results`);

            const mappedResults = [];

            // Helper: wrap a promise with a per-call timeout so a slow AI call
            // never blocks the entire international fallback indefinitely.
            const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
                Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

            const itemsWithPrice = [...organicItems].filter(r => {
                const priceUSD = r.price || this.extractPriceFromRawUSD(r.price_raw) || this.extractPriceFromSnippetUSD(r.snippet);
                if (!priceUSD) return false;
                r._priceUSD = priceUSD;
                return true;
            });

            // Process translations in parallel (max 10s per AI call)
            await Promise.allSettled(itemsWithPrice.map(async (r) => {
                const priceBRL = this.calculateInternationalPrice(r._priceUSD);
                const originalText = r.snippet || `${r.source || 'Shopping'} - ${r.title}`;

                const [translatedSnippet, translatedTitle] = await Promise.all([
                    withTimeout(this.aiService.translateAndAdaptSnippet(originalText), 10_000, originalText),
                    withTimeout(this.aiService.translateAndAdaptSnippet(r.title), 10_000, r.title),
                ]);

                mappedResults.push({
                    id: r.link,
                    title: translatedTitle || r.title,
                    price: priceBRL,
                    currency_id: 'BRL',
                    link: r.link,
                    snippet: translatedSnippet || originalText,
                    attributes: [],
                    type: r.source ? 'shopping_intl' : 'organic_intl'
                });
            }));

            return mappedResults;

        } catch (error) {
            this.logger.warn(`Error during international fallback search: ${error.message}`);
            return []; // Return empty array if fallback fails so the main flow isn't broken
        }
    }

    private calculateInternationalPrice(usdPrice: number): number {
        const baseBrl = usdPrice * this.EXCHANGE_RATE;
        const withImportTax = baseBrl * (1 + this.IMPORT_TAX_RATE);
        const withIcms = withImportTax / (1 - this.ICMS_RATE); // Check calculation standard: some use "gross up"
        const finalPrice = withIcms + this.COURIER_FEE_BRL;

        return parseFloat(finalPrice.toFixed(2));
    }

    private extractPriceFromRawUSD(raw: string): number | null {
        if (!raw) return null;
        // ex: '$150.00'
        const match = raw.match(/[\d,.]+/);
        if (match) {
            const priceStr = match[0].replace(/,/g, ''); // Remove thousands separator
            return parseFloat(priceStr);
        }
        return null;
    }

    private extractPriceFromSnippetUSD(snippet: string): number | null {
        if (!snippet) return null;
        const priceMatch = snippet.match(/\$\s?(\d{1,3}(,\d{3})*(\.\d{2})?)/);
        if (priceMatch) {
            const priceStr = priceMatch[1].replace(/,/g, ''); // Remove thousands separator
            return parseFloat(priceStr);
        }
        return null;
    }

    private extractPriceFromRaw(raw: string): number | null {
        if (!raw) return null;
        // ex: 'R$ 150,00'
        const match = raw.match(/[\d,.]+/);
        if (match) {
            const priceStr = match[0].replace(/\./g, '').replace(',', '.');
            return parseFloat(priceStr);
        }
        return null;
    }

    private extractPriceFromSnippet(snippet: string): number | null {
        if (!snippet) return null;
        const priceMatch = snippet.match(/R\$\s?(\d{1,3}(\.\d{3})*(,\d{2})?)/);
        if (priceMatch) {
            const priceStr = priceMatch[1].replace(/\./g, '').replace(',', '.');
            return parseFloat(priceStr);
        }
        return null;
    }

    async searchImages(query: string): Promise<WebImageResult[]> {
        const apiKey = this.config.get<string>('SERPER_API_KEY');
        if (!apiKey) throw new Error('SERPER_API_KEY not configured');

        this.logger.log(`[Images] Searching Serper images: ${query}`);

        const response = await axios.post(
            `${this.baseUrl}/images`,
            { q: query, gl: 'br', hl: 'pt-br', num: 20 },
            { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
        );

        const raw: any[] = response.data?.images || [];

        return raw
            .filter(img => img.imageUrl && img.imageWidth && img.imageHeight)
            .map(img => {
                const minSide = Math.min(img.imageWidth, img.imageHeight);
                const quality: 'high' | 'medium' | 'low' =
                    minSide >= 800 ? 'high' : minSide >= 400 ? 'medium' : 'low';
                return {
                    title: img.title || '',
                    imageUrl: img.imageUrl,
                    imageWidth: img.imageWidth,
                    imageHeight: img.imageHeight,
                    thumbnailUrl: img.thumbnailUrl || img.imageUrl,
                    source: img.source || '',
                    link: img.link || '',
                    quality,
                };
            });
    }
}

export interface WebImageResult {
    title: string;
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    thumbnailUrl: string;
    source: string;
    link: string;
    quality: 'high' | 'medium' | 'low';
}
