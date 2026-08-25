export interface StandardOrderItem {
    id: string; // Marketplace Item ID
    sku: string; // Seller SKU (marketplace-side)
    productId?: string; // Internal product ObjectId (resolved after order processing)
    title: string;
    quantity: number;
    unit_price: number;
    currency_id: string;

    // Tax & Internal Data (Populated by enrichment)
    ncm?: string;
    cfop?: string;
    uCom?: string; // Unidade Comercial
    uTrib?: string; // Unidade Tributável
    prod_orig?: number; // Origem do Produto (0, 1, 2...)

    internalProduct?: any; // Full internal product object if found

    original_data?: any; // Raw item data from marketplace
}

export interface StandardBuyer {
    id: string | number;
    nickname: string;
    name: string;
    first_name?: string;
    last_name?: string;
    document?: string; // CPF/CNPJ
    email?: string;
    phone?: string;

    address?: {
        street: string;
        number: string;
        zip_code: string;
        neighborhood: string;
        city: string;
        state: string;
        country: string;
        complement?: string;
    };

    billing_info?: any; // To allow access to billing.id if nested
}

export interface StandardPayment {
    id?: string | number;
    status?: string;
    payment_method_id?: string;
    payment_type?: string;
    operation_type?: string;

    // Cost breakdown (critical for P&L)
    transaction_amount?: number;  // item value
    total_paid_amount?: number;   // buyer's total outlay (gross)
    coupon_amount?: number;       // marketplace coupon discount
    taxes_amount?: number;        // taxes withheld at source
    marketplace_fee?: number;     // commission charged by marketplace
    net_received_amount?: number; // seller's net receipt

    installments?: number;
    authorization_code?: string;
    date_approved?: string;
}

export interface StandardOrder {
    id: string; // Marketplace Order ID
    pack_id?: string; // ML pack_id (required for /packs/{id}/fiscal_documents)
    marketplaceId: number | string;
    marketplaceName: string;
    marketplace?: {
        id: number;
        name: string;
        type?: string;
        icon?: string;
    };

    status: string; // Normalized status (paid, shipped, delivered, cancelled)
    date_created: Date | string;

    total_amount: number;
    couponAmount?: number; // Total order-level coupon/discount
    currency_id: string;

    buyer: StandardBuyer;
    items: StandardOrderItem[];

    // Logistics
    shipping?: {
        id: string;
        cost: number;
        tracking_number?: string;
        service_name?: string; // SEDEX, PAC, etc.
        status?: string;
        substatus?: string;
        trackingCode?: string;
        estimatedDelivery?: string;
        /** Envio Programado (ML) — data futura antes da qual NF-e/etiqueta não podem ser emitidas. */
        scheduledShippingDate?: string;
    };

    payments?: StandardPayment[];
    syncStatus?: string; // synced, pending, error
    original_data?: any;
    billing_info?: any;
}
