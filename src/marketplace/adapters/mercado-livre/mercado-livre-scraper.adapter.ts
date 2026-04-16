import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceDiscoveryAdapter, RawDiscoveryData } from '../../interfaces/discovery.interface';

@Injectable()
export class MercadoLivreScraperAdapter implements IMarketplaceDiscoveryAdapter {
    private readonly logger = new Logger(MercadoLivreScraperAdapter.name);
    private readonly ML_SEARCH_BASE_URL = 'https://lista.mercadolivre.com.br';
    private readonly MAX_RESULTS = 15;
    private readonly REQUEST_TIMEOUT_MS = 8_000;

    async search(query: string): Promise<RawDiscoveryData> {
        // ML search URLs use hyphens instead of %20
        const slug = encodeURIComponent(query).replace(/%20/g, '-');
        const url = `${this.ML_SEARCH_BASE_URL}/${slug}`;

        this.logger.log(`ML scraper: GET ${url}`);

        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Referer': 'https://www.mercadolivre.com.br/',
                'Cache-Control': 'no-cache',
            },
            timeout: this.REQUEST_TIMEOUT_MS,
        });

        const state = this.extractPreloadedState(html);
        if (!state) {
            this.logger.warn('ML scraper: could not extract __PRELOADED_STATE__ — returning empty');
            return { items: [] };
        }

        const rawResults = this.findResultsArray(state);
        const breadcrumb = this.extractBreadcrumb(html);

        const items = rawResults
            .filter((r: any) =>
                r.condition === 'new' &&
                Number(r.available_quantity) > 0 &&
                r.status === 'active'
            )
            .slice(0, this.MAX_RESULTS)
            .map((r: any) => ({
                id: r.id || r.permalink,
                title: r.title || '',
                price: r.price || r.prices?.amount || 0,
                currency_id: r.currency_id || 'BRL',
                link: r.permalink || '',
                snippet: r.title || '',
                category_path: breadcrumb || undefined,
                attributes: (r.attributes || []).map((a: any) => ({
                    id: a.id || '',
                    name: a.name || '',
                    value_name: a.value_name || '',
                })),
                isActive: true,
                condition: r.condition,
                type: 'ml_direct',
            }));

        this.logger.log(`ML scraper: ${items.length} active new results (${rawResults.length} raw)`);
        return { items };
    }

    private extractPreloadedState(html: string): unknown | null {
        // Pattern 1: encoded — window.__PRELOADED_STATE__ = JSON.parse(decodeURIComponent("..."))
        const encodedMatch = html.match(
            /window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/
        );
        if (encodedMatch) {
            try {
                return JSON.parse(decodeURIComponent(encodedMatch[1]));
            } catch { /* fall through to next pattern */ }
        }

        // Pattern 2: direct JSON — window.__PRELOADED_STATE__ = {...}
        // Find the script tag that declares it, then parse from first { to last }
        const scriptMatches = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)];
        for (const sm of scriptMatches) {
            const content = sm[1];
            if (!content.includes('__PRELOADED_STATE__')) continue;
            const jsonStart = content.indexOf('{');
            const jsonEnd = content.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) continue;
            try {
                return JSON.parse(content.slice(jsonStart, jsonEnd + 1));
            } catch { /* try next script tag */ }
        }

        return null;
    }

    private findResultsArray(state: unknown): any[] {
        // Try the most common ML state paths first
        const s = state as any;
        const candidates = [
            s?.results,
            s?.initialState?.results,
            s?.listingState?.results,
            s?.pageState?.results,
            s?.shops?.results,
        ];
        for (const c of candidates) {
            if (Array.isArray(c) && c.length > 0) return c;
        }
        // Fallback: deep-search for the first array whose items look like ML listings
        return this.deepFindResults(state) ?? [];
    }

    /** Recursively walk the state object looking for an array of ML listing items. */
    private deepFindResults(obj: unknown, depth = 0): any[] | null {
        if (depth > 6 || typeof obj !== 'object' || obj === null) return null;
        if (Array.isArray(obj) && obj.length > 0 && obj[0]?.title && obj[0]?.permalink) {
            return obj;
        }
        for (const key of Object.keys(obj as any)) {
            const found = this.deepFindResults((obj as any)[key], depth + 1);
            if (found) return found;
        }
        return null;
    }

    /** Extract BreadcrumbList from JSON-LD injected in the search page. */
    private extractBreadcrumb(html: string): string | null {
        const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
        let match: RegExpExecArray | null;
        while ((match = jsonLdRegex.exec(html)) !== null) {
            if (!match[1].includes('BreadcrumbList')) continue;
            try {
                const json = JSON.parse(match[1]);
                const graph: any[] = json['@graph'] || [json];
                const list = graph.find((g: any) => g['@type'] === 'BreadcrumbList');
                if (list?.itemListElement?.length) {
                    return list.itemListElement
                        .map((i: any) => i.item?.name || i.name)
                        .filter(Boolean)
                        .join(' > ');
                }
            } catch { /* ignore malformed JSON-LD */ }
        }
        return null;
    }
}
