# ML Scraper Discovery — Design Spec

## Goal

Replace Google/Serper as the primary data source for product discovery with a direct Mercado Livre scraper. Serper remains as fallback when ML returns insufficient results.

## Problem

`GoogleSerpDiscoveryAdapter` queries Serper (`site:mercadolivre.com.br`) and gets Google-indexed pages — often stale/removed listings. A direct ML scrape returns live, current data.

## Architecture

```
DiscoveryWorker.runDiscovery()
  └→ MercadoLivreScraperAdapter.search(query)   ← primary
       ├ ≥ 3 results  →  use ML results, skip Serper
       └ < 3 or error →  GoogleSerpDiscoveryAdapter.search(query)  ← fallback
```

No changes to `RawDiscoveryData` interface or anything downstream (`AiBatchService`, category auto-apply, etc.).

## New File

`src/marketplace/adapters/mercado-livre/mercado-livre-scraper.adapter.ts`

Implements `IMarketplaceDiscoveryAdapter`.

### Search request

- URL: `https://lista.mercadolivre.com.br/{encoded-query}`
- Single GET, no auth required
- Headers: realistic Chrome browser headers (`User-Agent`, `Accept`, `Accept-Language`, `Referer`)
- Timeout: 8 seconds

### Data extraction

ML embeds product data in a `<script>` tag as `window.__PRELOADED_STATE__ = {...}` or `window.__PRELOADED_STATE__=` (no space variant). Parse with regex, then `JSON.parse`.

If the preloaded state is not found (ML changed structure), fall back to parsing `<script type="application/json">` tags or the `polyglot` initialState pattern ML has used historically.

### Filtering

From the parsed results array, keep only items where:
- `condition === 'new'`
- `available_quantity > 0` AND `status === 'active'` (or equivalent active signal in the JSON)

### Mapped fields (→ `RawDiscoveryData` item shape)

| ML field | Output field |
|---|---|
| `title` | `title` |
| `price` / `prices.amount` | `price` |
| `permalink` | `link`, `id` |
| `condition` | filtered (new only) |
| `category_path` from breadcrumbs | `category_path` |
| `attributes[]` | `attributes` |
| `'BRL'` | `currency_id` |
| `available_quantity > 0 && status === 'active'` | `isActive: true` |

Breadcrumbs live in the preloaded state under a `breadcrumb` or `breadcrumbs` key at the page level (not per-item). Apply the same breadcrumb to all items from that search page.

### Error handling

Any network error or JSON parse failure throws, letting `DiscoveryWorker` catch it and fall through to Serper.

Return at most 15 items (slice before returning).

## Changes to Existing Files

### `discovery.consumer.ts` (DiscoveryWorker)

Inject `MercadoLivreScraperAdapter` alongside the existing `serpAdapter`.

Replace:
```ts
const rawData = await this.serpAdapter.search(msg.query);
```

With:
```ts
let rawData: RawDiscoveryData;
try {
  rawData = await this.mlScraper.search(msg.query);
  if (rawData.items.length < 3) {
    this.logger.log(`ML scraper returned ${rawData.items.length} results — falling back to Serper`);
    rawData = await this.serpAdapter.search(msg.query);
  }
} catch (err) {
  this.logger.warn(`ML scraper failed (${err.message}) — falling back to Serper`);
  rawData = await this.serpAdapter.search(msg.query);
}
```

### `product.module.ts`

Add `MercadoLivreScraperAdapter` to `providers`.

## Out of Scope

- Proxy support (not needed for low-volume internal use)
- Visiting individual listing pages (all required data is on the search results page)
- Pagination (first page of results is sufficient for discovery)
- Changes to `AiBatchService.sanitizeDiscoveryData` or any downstream consumer
