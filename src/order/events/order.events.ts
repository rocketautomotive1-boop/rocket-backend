export class OrderSyncedEvent {
    constructor(
        public readonly orderId: string,
        public readonly externalId: string,
        public readonly marketplaceId: number,
        public readonly items: Array<{
            sku: string;
            productId: string | null; // Changed from number to string (MongoDB _id)
            quantity: number;
            unitPrice: number;
        }>,
        public readonly marketplaceName?: string
    ) { }
}

export const ORDER_EVENTS = {
    SYNCED: 'order.synced',
    CREATED: 'order.created',
    CANCELLED: 'order.cancelled',
    PROCESSED: 'order.processed',
    PRICING_CALCULATED: 'order.pricing.calculated',
    SYNC_COMPLETED: 'order.sync.completed',
    SYNC_FAILED: 'order.sync.failed',
};

export class OrderCancelledEvent {
    constructor(
        public readonly orderId: string,
        public readonly externalId: string,
        public readonly marketplaceId: string,
        public readonly marketplaceName: string,
        public readonly totalAmount: number,
        public readonly cancelReason: string | null,
        public readonly cancelledBy: string | null, // 'buyer' | 'seller' | 'system'
        public readonly stockReverted: boolean,
        public readonly triggeredBy: 'webhook' | 'sync',
    ) {}
}

export class OrderProcessedEvent {
    constructor(
        public readonly orderId: string,
        public readonly externalId: string,
        public readonly marketplaceId: string,
        public readonly marketplaceName: string,
        public readonly items: Array<{
            productId: string;
            quantity: number;
            unitPrice: number;
            sku: string;
        }>,
        public readonly totalAmount: number,
        public readonly triggeredBy: 'webhook' | 'sync' | 'retry' | 'manual',
    ) { }
}

export class OrderPricingCalculatedEvent {
    constructor(
        public readonly orderId: string,
        public readonly externalId: string,
        public readonly marketplaceId: string,
        public readonly marketplaceName: string,
        public readonly pricing: any, // OrderPricingDetailDto
        public readonly triggeredBy: 'webhook' | 'sync' | 'retry' | 'manual' = 'sync',
    ) { }
}
