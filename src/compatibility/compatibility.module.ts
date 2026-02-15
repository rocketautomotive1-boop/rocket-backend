import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CompatibilityService } from './compatibility.service';
import { MercadoLivreAuthAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { CatalogCompatibilityController, CatalogDomainsController } from './catalog-compatibility.controller';
import { CompatibilityController } from './compatibility-controller';
import { ProductCompatibilityDocument } from '../product/product-types';
import { QueueModule } from '../queue/queue.module';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    MarketplaceModule,
    forwardRef(() => QueueModule),
    forwardRef(() => ProductModule),
  ],
  controllers: [
    CompatibilityController,
    CatalogCompatibilityController,
    CatalogDomainsController
  ],

  providers: [
    CompatibilityService,
  ],
  exports: [
    CompatibilityService,
  ],
})
export class CompatibilityModule { }