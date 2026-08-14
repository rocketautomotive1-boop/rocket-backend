export type DiscoveryRealtimeStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface DiscoveryRealtimeEvent {
    jobId: string;
    status: DiscoveryRealtimeStatus;
    result?: Record<string, any>;
    error?: string;
    step?: string;
    message?: string;
}

