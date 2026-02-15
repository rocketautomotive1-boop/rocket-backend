import { MongooseModule } from '@nestjs/mongoose';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { CompatibilitiesService } from './compatibilities.service';
import { Module, forwardRef } from '@nestjs/common';
import { CompatibilitiesController } from './controllers/compatibilities.controller';
import { MercadoLivreCompatibilityAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { HttpModule } from '@nestjs/axios';
import { MercadoLivreAuthAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';

import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProductTitleService } from '../product/services/product-title.service';
import { QueueModule } from '../queue/queue.module';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
      { name: ProductModel.name, schema: ProductSchema },
    ]),
    HttpModule,
    MarketplaceModule,
    forwardRef(() => QueueModule),
    forwardRef(() => ProductModule),
  ],
  providers: [
    CompatibilitiesService,
  ],
  controllers: [CompatibilitiesController],
  exports: [CompatibilitiesService],
})

export class CompatibilitiesModule { }


