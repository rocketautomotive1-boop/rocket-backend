import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InternalTokenController } from './internal-token.controller';
import { InternalSignController } from './internal-sign.controller';
import { InternalProductController } from './internal-product.controller';
import { InternalListingController } from './internal-listing.controller';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { StockMovementModel, StockMovementSchema } from '../product/schemas/stock-movement.schema';

@Module({
    imports: [
        MarketplaceAuthModule,
        MarketplaceRegistryModule,
        forwardRef(() => MarketplaceModule),
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: StockMovementModel.name, schema: StockMovementSchema },
        ]),
    ],
    controllers: [InternalTokenController, InternalSignController, InternalProductController, InternalListingController],
})
export class InternalModule {}
