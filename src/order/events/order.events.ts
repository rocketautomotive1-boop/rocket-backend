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
    CANCELLED: 'order.cancelled'
};
