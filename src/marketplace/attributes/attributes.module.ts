import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductAttributesService } from '../services/product-attributes.service';
import { MercadoLivreAttributesService } from '../services/mercado-livre-attributes.service';
import { MarketplaceModule } from '../marketplace.module';
import { QueueModule } from '../../queue/queue.module';
import { ProductModule } from '../../product/product.module';
import { ProductModel, ProductSchema } from '../../product/schemas/product.schema';
import { MarketplaceCategoryModel, MarketplaceCategorySchema } from '../schemas/marketplace-category.schema';
// import { CategoryMappingModel, CategoryMappingSchema } from '../schemas/category-mapping.schema';
import { MarketplaceModel, MarketplaceSchema } from '../schemas/marketplace.schema';
import { MercadoLivreCategoryAdapter } from '../adapters/mercado-livre/mercado-livre-category.adapter';
import { MercadoLivreAuthAdapter } from '../adapters/mercado-livre/mercado-livre-auth.adapter';
import { MarketplaceOrchestratorModule } from '../../marketplace-orchestrator/marketplace-orchestrator.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: MarketplaceCategoryModel.name, schema: MarketplaceCategorySchema },
      { name: MarketplaceModel.name, schema: MarketplaceSchema },
    ]),
    forwardRef(() => MarketplaceModule),
    forwardRef(() => QueueModule),
    forwardRef(() => ProductModule),
    forwardRef(() => MarketplaceOrchestratorModule),
  ],
  providers: [
    ProductAttributesService,
    MercadoLivreAttributesService
  ],
  exports: [
    ProductAttributesService,
    MercadoLivreAttributesService
  ]
})
export class AttributesModule { }