import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InternalTokenController } from './internal-token.controller';
import { InternalProductController } from './internal-product.controller';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';

@Module({
    imports: [
        MarketplaceAuthModule,
        MarketplaceRegistryModule,
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: ListingModel.name, schema: ListingSchema },
        ]),
    ],
    controllers: [InternalTokenController, InternalProductController],
})
export class InternalModule {}
