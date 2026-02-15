import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { ProductDocument } from '../../product/product-types';


export interface IMarketplaceProductAdapter {
    publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<{
        success: boolean;
        externalId?: string;
        skipped?: boolean;
        error?: string;
        result?: any;
        requestPayload?: any;
        responsePayload?: any;
        action?: string;
        title?: string;
    }>;

    unpublishProduct?(externalId: string, marketplace: MarketplaceDocument): Promise<{
        success: boolean;
        error?: string;
        result?: any;
    }>;

    getListings?(params: any): Promise<any[]>;
    getListingDetail?(externalId: string): Promise<any>;
}
