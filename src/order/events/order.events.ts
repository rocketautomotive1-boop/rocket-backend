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
    /**
     * Venda pronta para notificação: financeiro já resolvido e snapshot persistido
     * pelo domínio (order/). Payload autocontido — o broker (notifications) só formata
     * e roteia para os canais. Mantém o transporte/canal sem acoplamento a order.
     */
    SALE_NOTIFICATION: 'order.sale.notification',
};

export interface OrderSaleNotificationFinancial {
    gross: number;
    saleFee: number;
    freight: number;
    taxes: number;
    coupon: number;
    net: number;
    costTotal: number;
    grossProfit: number;
    marginPct: number;
}

/**
 * Evento autocontido de venda para notificação. Tudo que o formatter precisa já
 * vem resolvido — notifications NÃO lê OrderModel nem chama serviços de order.
 */
export class OrderSaleNotificationEvent {
    constructor(
        public readonly orderId: string,
        public readonly externalId: string,
        public readonly marketplace: string,
        public readonly createdAt: string,
        public readonly buyerName: string,
        public readonly firstItemTitle: string,
        public readonly extraItemsCount: number,
        public readonly firstQty: number,
        public readonly firstUnitPrice: number,
        public readonly itemsTotal: number,
        public readonly financial: OrderSaleNotificationFinancial,
        public readonly triggeredBy: 'webhook' | 'sync' | 'retry' | 'manual' = 'sync',
    ) {}
}

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
        // Fonte da detecção. 'webhook'/'reconcile'/'gap-detector' = real-time (notifica
        // WhatsApp); 'sync' = fix em massa (silencioso). Mantido como string ampla.
        public readonly triggeredBy: 'webhook' | 'reconcile' | 'gap-detector' | 'sync',
        // Contexto autocontido p/ a mensagem (notifications não lê OrderModel).
        public readonly firstItemTitle?: string,
        public readonly firstQty?: number,
        public readonly extraItemsCount?: number,
        public readonly soldAt?: string | null, // marketplaceCreatedAt (data real da venda)
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
