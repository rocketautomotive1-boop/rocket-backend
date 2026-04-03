import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OLXProductAdapter } from './olx-product.adapter';
import { OLXImportService } from './olx-import.service';
import { OLXCatalogService } from './olx-catalog.service';
import { OLXHighlightsService } from './olx-highlights.service';
import { OLXWebhookService } from './olx-webhook.service';
import { OLXController } from './olx.controller';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ProductModule } from '../../../product/product.module';
import { MarketplaceModule } from '../../../marketplace/marketplace.module';

@Module({
  imports: [
    HttpModule,
    ProductModule,
    MarketplaceModule,
  ],
  controllers: [OLXController],
  providers: [],
  exports: []
})
export class OLXModule { } 