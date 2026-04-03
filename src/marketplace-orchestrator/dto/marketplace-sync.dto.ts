
export class MarketplaceSyncPayload {
    jobId: string;
    attemptId?: string;
    marketplaceId: string;
    listingId: string;
    externalId?: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'PAUSE' | 'UNPAUSE';
    metadata?: {
        userId?: string;
        [key: string]: any;
    };

    product: any; // Full Product Snapshot

    marketplace: {
        tag: string;
        credentials: {
            accessToken: string;
            refreshToken?: string;
            expiresAt?: string;
            [key: string]: any;
        };
        settings: any;
    };

    payload: {
        title: string;
        description: string;
        price: number;
        stock: number;
        attributes: any;
        brand?: string;
        images: string[];
        sku: string;
        dimensions?: {
            length: number;
            width: number;
            height: number;
            weight: number;
        };
    };
}
