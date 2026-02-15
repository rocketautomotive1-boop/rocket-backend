export class MarketplaceSyncResult {
    jobId: string;
    attemptId?: string;
    marketplaceId: string;
    listingId: string;
    success: boolean;
    action: string;

    externalId?: string;
    errorMessage?: string;

    timestamp: Date;
    metadata?: any;
}
