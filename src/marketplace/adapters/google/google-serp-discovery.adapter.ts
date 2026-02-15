import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IMarketplaceDiscoveryAdapter, RawDiscoveryData } from '../../interfaces/discovery.interface';

@Injectable()
export class GoogleSerpDiscoveryAdapter implements IMarketplaceDiscoveryAdapter {
    private readonly logger = new Logger(GoogleSerpDiscoveryAdapter.name);
    private readonly baseUrl = 'https://google.serper.dev';

    constructor(private readonly config: ConfigService) { }

    async search(query: string): Promise<RawDiscoveryData> {
        const apiKey = this.config.get<string>('SERPER_API_KEY');
        if (!apiKey) {
            throw new Error('SERPER_API_KEY not configured in .env');
        }

        // Otimizar query: site:mercadolivre.com.br "{partNumber} {brand}"
        const organicQuery = `site:mercadolivre.com.br ${query}`;
        this.logger.log(`Searching Google via Serper (Organic): ${organicQuery}`);

        try {
            // Parallel requests: Organic + Shopping
            const [organicRes, shoppingRes] = await Promise.allSettled([
                axios.post(
                    `${this.baseUrl}/search`,
                    {
                        q: organicQuery,
                        gl: 'br',
                        hl: 'pt-br',
                        num: 15,
                    },
                    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
                ),
                axios.post(
                    `${this.baseUrl}/shopping`,
                    {
                        q: query, // Use the raw query for shopping to get broader price matches
                        gl: 'br',
                        hl: 'pt-br',
                        num: 15,
                    },
                    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
                )
            ]);

            const organicItems = organicRes.status === 'fulfilled' ? (organicRes.value.data.organic || []) : [];
            const shoppingItems = shoppingRes.status === 'fulfilled' ? (shoppingRes.value.data.shopping || []) : [];

            this.logger.log(`Found ${organicItems.length} organic results and ${shoppingItems.length} shopping results`);

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

            // Map Shopping Results
            const mappedShopping = shoppingItems.map((r: any) => ({
                id: r.link,
                title: r.title,
                price: r.price || this.extractPriceFromRaw(r.price_raw) || 0,
                currency_id: 'BRL',
                link: r.link,
                snippet: `${r.source || 'Shopping'} - ${r.title}`, // Shopping usually has 'source'
                attributes: [],
                type: 'shopping'
            }));

            // Combine results.
            return {
                items: [...mappedShopping, ...mappedOrganic]
            };

        } catch (error) {
            this.logger.error(`Error calling Serper API: ${error.message}`);
            throw error;
        }
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
}
