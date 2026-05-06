# ML Scraper Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct Mercado Livre HTML scraper as the primary data source for product discovery, with the existing Serper/Google adapter as automatic fallback when ML returns fewer than 3 results.

**Architecture:** A new `MercadoLivreScraperAdapter` makes a single GET request to `lista.mercadolivre.com.br/{query}`, extracts the `__PRELOADED_STATE__` JSON blob embedded in the page, filters results to new + active listings, and returns them in the existing `RawDiscoveryData` shape. `DiscoveryWorker` tries this adapter first and silently falls back to `GoogleSerpDiscoveryAdapter` on failure or insufficient results.

**Tech Stack:** NestJS, axios, TypeScript. No new npm packages needed.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| **Create** | `src/marketplace/adapters/mercado-livre/mercado-livre-scraper.adapter.ts` | New `@Injectable()` class implementing `IMarketplaceDiscoveryAdapter` |
| **Modify** | `src/marketplace/marketplace.module.ts` | Add `MercadoLivreScraperAdapter` to providers + exports |
| **Modify** | `src/product/consumers/discovery.consumer.ts` | Inject adapter, replace single `serpAdapter.search()` call with try/fallback block |

---

## Task 1: Create `MercadoLivreScraperAdapter`

**Files:**
- Create: `src/marketplace/adapters/mercado-livre/mercado-livre-scraper.adapter.ts`

- [ ] **Step 1: Create the file with full implementation**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceDiscoveryAdapter, RawDiscoveryData } from '../../interfaces/discovery.interface';

@Injectable()
export class MercadoLivreScraperAdapter implements IMarketplaceDiscoveryAdapter {
    private readonly logger = new Logger(MercadoLivreScraperAdapter.name);

    async search(query: string): Promise<RawDiscoveryData> {
        // ML search URLs use hyphens instead of %20
        const slug = encodeURIComponent(query).replace(/%20/g, '-');
        const url = `https://lista.mercadolivre.com.br/${slug}`;

        this.logger.log(`ML scraper: GET ${url}`);

        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Referer': 'https://www.mercadolivre.com.br/',
                'Cache-Control': 'no-cache',
            },
            timeout: 8000,
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
            .slice(0, 15)
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

    private extractPreloadedState(html: string): any | null {
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

    private findResultsArray(state: any): any[] {
        // Try the most common ML state paths first
        const candidates = [
            state?.results,
            state?.initialState?.results,
            state?.listingState?.results,
            state?.pageState?.results,
            state?.shops?.results,
        ];
        for (const c of candidates) {
            if (Array.isArray(c) && c.length > 0) return c;
        }
        // Fallback: deep-search for the first array whose items look like ML listings
        return this.deepFindResults(state) ?? [];
    }

    /** Recursively walk the state object looking for an array of ML listing items. */
    private deepFindResults(obj: any, depth = 0): any[] | null {
        if (depth > 6 || typeof obj !== 'object' || obj === null) return null;
        if (Array.isArray(obj) && obj.length > 0 && obj[0]?.title && obj[0]?.permalink) {
            return obj;
        }
        for (const key of Object.keys(obj)) {
            const found = this.deepFindResults(obj[key], depth + 1);
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd marketplace-integration
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (zero errors).

- [ ] **Step 3: Commit**

```bash
git add src/marketplace/adapters/mercado-livre/mercado-livre-scraper.adapter.ts
git commit -m "feat(discovery): add MercadoLivreScraperAdapter for direct ML search scraping"
```

---

## Task 2: Register adapter in `MarketplaceModule`

**Files:**
- Modify: `src/marketplace/marketplace.module.ts`

`GoogleSerpDiscoveryAdapter` appears twice in this file — once in `providers` and once in `exports`. Follow the exact same pattern for the new adapter.

- [ ] **Step 1: Add import at the top of the file**

Find the line:
```typescript
import { GoogleSerpDiscoveryAdapter } from './adapters/google/google-serp-discovery.adapter';
```

Add immediately after it:
```typescript
import { MercadoLivreScraperAdapter } from './adapters/mercado-livre/mercado-livre-scraper.adapter';
```

- [ ] **Step 2: Add to `providers` array**

Find in the `providers` array:
```typescript
    GoogleSerpDiscoveryAdapter,
```
(the first occurrence, inside `providers`)

Add the new adapter on the line immediately after it:
```typescript
    GoogleSerpDiscoveryAdapter,
    MercadoLivreScraperAdapter,
```

- [ ] **Step 3: Add to `exports` array**

Find in the `exports` array:
```typescript
    GoogleSerpDiscoveryAdapter,
```
(the second occurrence, inside `exports`)

Add the new adapter on the line immediately after it:
```typescript
    GoogleSerpDiscoveryAdapter,
    MercadoLivreScraperAdapter,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd marketplace-integration
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/marketplace/marketplace.module.ts
git commit -m "feat(discovery): register MercadoLivreScraperAdapter in MarketplaceModule"
```

---

## Task 3: Wire `MercadoLivreScraperAdapter` into `DiscoveryWorker`

**Files:**
- Modify: `src/product/consumers/discovery.consumer.ts`

- [ ] **Step 1: Add import**

Find the line:
```typescript
import { GoogleSerpDiscoveryAdapter } from '../../marketplace/adapters/google/google-serp-discovery.adapter';
```

Add immediately after it:
```typescript
import { MercadoLivreScraperAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-scraper.adapter';
import { RawDiscoveryData } from '../../marketplace/interfaces/discovery.interface';
```

- [ ] **Step 2: Inject the new adapter in the constructor**

Find:
```typescript
    constructor(
        private readonly serpAdapter: GoogleSerpDiscoveryAdapter,
        private readonly aiService: AiBatchService,
```

Replace with:
```typescript
    constructor(
        private readonly serpAdapter: GoogleSerpDiscoveryAdapter,
        private readonly mlScraper: MercadoLivreScraperAdapter,
        private readonly aiService: AiBatchService,
```

- [ ] **Step 3: Replace the single `serpAdapter.search()` call with ML-first + fallback logic**

Find:
```typescript
        // 1. SERP search
        const rawData = await this.serpAdapter.search(msg.query);
```

Replace with:
```typescript
        // 1. ML scraper (primary) → Serper (fallback)
        let rawData: RawDiscoveryData;
        try {
            rawData = await this.mlScraper.search(msg.query);
            if (rawData.items.length < 3) {
                this.logger.log(`ML scraper returned ${rawData.items.length} results — falling back to Serper`);
                rawData = await this.serpAdapter.search(msg.query);
            } else {
                this.logger.log(`ML scraper: using ${rawData.items.length} results`);
            }
        } catch (err: any) {
            this.logger.warn(`ML scraper failed (${err.message}) — falling back to Serper`);
            rawData = await this.serpAdapter.search(msg.query);
        }
```

- [ ] **Step 4: Verify TypeScript compiles with zero errors**

```bash
cd marketplace-integration
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/product/consumers/discovery.consumer.ts
git commit -m "feat(discovery): use ML scraper as primary source with Serper fallback in DiscoveryWorker"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start the backend**

```bash
cd marketplace-integration
npm run start:dev
```

- [ ] **Step 2: Trigger a discovery job**

Use the existing discovery endpoint with a known part number (e.g. `45022-SHZ-003 Honda`). Check backend logs for one of:
- `ML scraper: using N results` — ML worked
- `ML scraper returned N results — falling back to Serper` — ML found too few, Serper used
- `ML scraper failed (...) — falling back to Serper` — network/parse error, Serper used

All three paths are valid — the job must complete without error regardless of which source is used.

- [ ] **Step 3: Verify discovery result contains real data**

The discovery job should complete with `status: COMPLETED` and the `result` object should have populated `titles`, `prices`, and optionally `categoryPath`.

- [ ] **Step 4: Final commit (if any adjustments were needed during smoke test)**

```bash
git add -p
git commit -m "fix(discovery): adjust ML scraper after smoke test"
```
