import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InternalTokenController } from './internal-token.controller';
import { InternalSignController } from './internal-sign.controller';
import { InternalProductController } from './internal-product.controller';
import { InternalListingController } from './internal-listing.controller';
import { InternalRembgController } from './internal-rembg.controller';
import { GatewaysModule } from '../gateways/gateways.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductModule } from '../product/product.module';
import { StockModule } from '../stock/stock.module';
import { PricingModule } from '../pricing/pricing.module';
import { StoreListingModule } from '../store-listing/store-listing.module';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { UserModel, UserSchema } from '../auth/schemas/user.schema';

@Module({
    imports: [
        MarketplaceAuthModule,
        MarketplaceRegistryModule,
        forwardRef(() => MarketplaceModule),
        forwardRef(() => ProductModule),
        StockModule,
        PricingModule,
        StoreListingModule,
        GatewaysModule,
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: UserModel.name, schema: UserSchema },
        ]),
    ],
    controllers: [InternalTokenController, InternalSignController, InternalProductController, InternalListingController, InternalRembgController],
})
export class InternalModule {}
