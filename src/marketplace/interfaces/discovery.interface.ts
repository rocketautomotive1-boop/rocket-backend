export interface RawDiscoveryData {
    items: Array<{
        id: string;
        title: string;
        price: number;
        currency_id: string;
        category_path?: string;
        attributes: Array<{
            id: string;
            name: string;
            value_name: string;
            [key: string]: any;
        }>;
        [key: string]: any;
    }>;
}

export interface IMarketplaceDiscoveryAdapter {
    search(query: string): Promise<RawDiscoveryData>;
}
