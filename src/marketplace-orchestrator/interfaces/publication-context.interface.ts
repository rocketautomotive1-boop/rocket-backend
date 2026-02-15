import { ProductDocument } from '../../product/schemas/product.schema';
import { MarketplaceDocument } from '../../marketplace/schemas/marketplace.schema';
import { ListingDocument } from '../../listing/schemas/listing.schema';

export interface PublicationContext {
    listing: ListingDocument;
    product: ProductDocument;
    marketplace: MarketplaceDocument;
    jobId: string;
}
