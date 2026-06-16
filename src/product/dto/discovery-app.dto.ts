export interface DiscoveryVehicleSuggestion {
    label: string;
}

export interface DiscoveryPriceRange {
    min: number;
    avg: number;
    max: number;
}

export interface MenorPrecoOfferDto {
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

export interface MenorPrecoDto {
    stats: { min: number | null; avg: number | null; max: number | null; count: number } | null;
    offers: MenorPrecoOfferDto[];
    confidence?: string;
}

export interface DiscoveryAppData {
    titles: string[];
    prices: DiscoveryPriceRange | null;
    description: string;
    details: string;
    attributes: Array<{ key: string; value: string; id?: string }>;
    oemCodes: string[];
    vehicles: DiscoveryVehicleSuggestion[];
    categoryPath: string | null;
    breadcrumbPath: string;
    suggestedImages: string[];
    winningSource: 'mercadolivre' | 'serp' | null;
    confidence: string | null;
    partNumber: string;
    rawItems: any[];
    resolvedCategoryId: string | null;
    timing: { serp: number; mercadolivre: number; ai: number; total: number } | null;
    menorPreco: MenorPrecoDto | null;
}

export interface DiscoveryAppDocument {
    id: string;
    _discoveryId: string;
    batchId: string;
    query: string;
    status: 'pending' | 'processing' | 'done' | 'failed';
    intentVersion?: number;
    isActiveIntent?: boolean;
    createdAt: string;
    updatedAt: string;
    error?: string | null;
    data: DiscoveryAppData;
}
