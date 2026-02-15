export interface StandardOrderItem {
    id: string; // Marketplace Item ID
    sku: string; // Seller SKU
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

export interface StandardOrder {
    id: string; // Marketplace Order ID
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
    currency_id: string;

    buyer: StandardBuyer;

    items: StandardOrderItem[];


    // Logistics
    shipping?: {
        id: string;
        cost: number;
        tracking_number?: string;
        service_name?: string; // SEDEX, PAC, etc.
    };

    syncStatus?: string; // synced, pending, error

    original_data?: any; // Raw order data from marketplace

    billing_info?: any; // Billing info from marketplace (e.g. Mercado Livre)

    payments?: any[]; // Payment details
}
