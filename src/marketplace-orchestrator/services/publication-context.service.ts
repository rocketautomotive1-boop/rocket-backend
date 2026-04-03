import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';

import { ProductModel } from '../../product/schemas/product.schema';
import { MarketplaceModel } from '../../marketplace/schemas/marketplace.schema';
import { ListingModel } from '../../listing/schemas/listing.schema';
import { PublicationContext } from '../interfaces/publication-context.interface';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';

@Injectable()
export class PublicationContextService {
    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
        @InjectModel(MarketplaceModel.name) private marketplaceModel: Model<MarketplaceModel>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingModel>,
        private readonly authService: MarketplaceAuthService,
    ) { }

    async buildContext(listingId: string, requesterId?: string): Promise<PublicationContext> {
        const listing = await this.listingModel.findById(listingId).exec();
        if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);

        // [OPTIMIZATION] Token check moved to Worker to prevent Orchestrator blocking/locking.
        // The worker will fetch a fresh token immediately before execution.


        const product = await this.productModel.findById(listing.productId).populate('category').exec();
        if (!product) throw new NotFoundException(`Product ${listing.productId} not found`);

        // Fetch Marketplace AFTER token check to ensure we get the updated token
        const marketplace = await this.marketplaceModel.findById(listing.marketplaceId).exec();
        if (!marketplace) throw new NotFoundException(`Marketplace ${listing.marketplaceId} not found`);

        if (!marketplace.enabled) throw new BadRequestException(`Marketplace ${marketplace.name} is disabled`);

        return {
            listing,
            product,
            marketplace,
            jobId: randomUUID()
        };
    }
}
