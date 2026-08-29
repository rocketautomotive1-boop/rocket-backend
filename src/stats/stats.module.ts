import { Module, forwardRef } from '@nestjs/common';
import { StatsController } from './controllers/stats.controller';
import { StatsService } from './services/stats.service';

import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../store-listing/schemas/store-listing-stock-movement.schema';

import { AuthModule } from '../auth/auth.module';
import { ListingModule } from '../listing/listing.module'; // [FIX]

import { AllocationModel, AllocationSchema } from '../product/schemas/allocation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
      { name: 'AllocationModel', schema: AllocationSchema },
    ]),
    ListingModule, // [FIX] Import ListingModule
    forwardRef(() => AuthModule),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule { }