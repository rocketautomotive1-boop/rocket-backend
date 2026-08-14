/** Response sent back to marketplace-integration with scraped + enriched data. */
export interface CanonicalProfile {
    canonicalTitle: string;
    productType: string;
    canonicalPartNumber: string;
    requiredKeywords: string[];
    strongKeywords: string[];
    optionalKeywords: string[];
    negativeKeywords: string[];
    vehicleHints: string[];
}

export interface DiscoveryScraperResponse {
    jobId: string;
    query: string;
    status: 'completed' | 'failed';
    error?: string;
    results: DiscoveryResults;
    scrapedAt: string;
}

export interface DiscoveryResults {
    // Explicit sections for isolation
    ai: {
        titles: string[];
        prices: { min: number; avg: number; max: number } | null;
        description: string;
        details: string;
        attributes: any[];
        oemCodes: string[];
        vehicles: any[];
        categoryPath: string | null;
    };
    mercadolivre: {
        titles: string[];
        prices: { min: number; avg: number; max: number } | null;
        suggestedImages: string[];
        breadcrumb: string | null;
        items: NormalizedItem[];
    };
    serp: {
        items: NormalizedItem[];
    };
    // Preços de mercado (Menor Preço / SEFAZ, PE por EAN). Domínio general.
    menorPreco?: {
        stats: { min: number | null; avg: number | null; max: number | null; count: number } | null;
        offers: MenorPrecoOffer[];
    };

    // Legacy fields for backward compatibility with monolith
    titles: string[];
    prices: { min: number; avg: number; max: number } | null;
    description?: string;
    details?: string;
    categoryPath?: string | null;
    suggestedImages: string[];
    attributes: any[];
    oemCodes: string[];
    vehicles?: any[];
    sources: {
        serp: { items: NormalizedItem[] };
        mercadolivre: { items: NormalizedItem[] };
        menorPreco?: {
            stats: { min: number | null; avg: number | null; max: number | null; count: number } | null;
            offers: MenorPrecoOffer[];
            confidence: string;
        };
    };
}

export interface MenorPrecoOffer {
    seller_name: string | null;
    legal_name: string | null;
    address: string | null;
    bairro: string | null;
    mun: string | null;
    uf: string | null;
    price: number | null;
    list_price: number | null;
    sold_at: string | null;
    dist_km: number | null;
}

export interface NormalizedItem {
    id: string;
    title: string;
    price: number | null;
    currency_id: string;
    url: string;
    link: string;
    snippet: string;
    attributes: any[];
    type: string;
    isActive: boolean;
    status: string;
    condition: string;
    images: string[];
    breadcrumb: string | null;
    partNumber?: string | null;
}
