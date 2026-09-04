import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';
import { AllocationModel, AllocationSchema } from '../product/schemas/allocation.schema';
import { ListingModule } from '../listing/listing.module';
import { MarketplaceOrchestratorModule } from '../marketplace-orchestrator/marketplace-orchestrator.module';
import { MarketplaceConfigCacheModule } from '../marketplace/services/marketplace-config-cache.module';
import { AuthModule } from '../auth/auth.module';
import { ProductDeletionService } from './product-deletion.service';
import { AdminProductDeletionController } from './admin-product-deletion.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: AllocationModel.name, schema: AllocationSchema },
    ]),
    ListingModule,
    forwardRef(() => MarketplaceOrchestratorModule),
    MarketplaceConfigCacheModule,
    AuthModule,
  ],
  controllers: [AdminProductDeletionController],
  providers: [ProductDeletionService],
  exports: [ProductDeletionService],
})
export class ProductDeletionModule {}
