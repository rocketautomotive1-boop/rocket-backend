export interface MarketplacePublishResult {
    marketplaceName: string;
    success: boolean;
    status: 'PUBLISHED' | 'SKIPPED' | 'FAILED';
    message: string;
    externalId?: string;
    details?: any;
    requestPayload?: any;
    responsePayload?: any;
    duration?: number;
    error?: string;
    results?: any[];  // Array de resultados individuais de cada título
}

/**
 * Log entry for publication process tracking
 */
export interface PublicationLog {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    marketplace: string;
    phase: 'start' | 'validation' | 'description' | 'token' | 'adapter_call' | 'persistence' | 'complete' | 'error';
    message: string;
    data?: any;
    duration?: number;
}

/**
 * Enhanced publication result with structured logs
 */
export interface EnhancedPublishResult {
    productId: string | number;
    results: MarketplacePublishResult[];
    summary: {
        total: number;
        successful: number;
        failed: number;
        totalDuration: number;
    };
}
