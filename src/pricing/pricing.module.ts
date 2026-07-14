import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductPricingModel, ProductPricingSchema } from './schemas/product-pricing.schema';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';
import { PRICING_PORT } from './ports/pricing.port';
import { PromotionExpiryJob } from './jobs/promotion-expiry.job';

/**
 * Sole owner of sale price. Leaf module — imports no domain module; productId is passed as data.
 * Exposes only PRICING_PORT (+ PricingService) to consumers.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProductPricingModel.name, schema: ProductPricingSchema }]),
  ],
  providers: [
    PricingRepository,
    PricingService,
    { provide: PRICING_PORT, useExisting: PricingService },
    PromotionExpiryJob,
  ],
  exports: [PRICING_PORT, PricingService],
})
export class PricingModule {}
