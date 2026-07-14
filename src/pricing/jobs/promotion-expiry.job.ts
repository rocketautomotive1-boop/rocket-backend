import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductPricingModel, ProductPricingDocument } from '../schemas/product-pricing.schema';

/**
 * Limpa `promotion` de documentos vencidos. PricingService.getPricing já ignora promoção expirada
 * na leitura (correção nunca depende só deste job) — isto é manutenção, mantém os documentos
 * limpos. Ver docs/superpowers/specs/2026-07-13-offers-system-design.md.
 */
@Injectable()
export class PromotionExpiryJob {
  private readonly logger = new Logger(PromotionExpiryJob.name);

  constructor(
    @InjectModel(ProductPricingModel.name) private readonly pricingModel: Model<ProductPricingDocument>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async expire(): Promise<void> {
    const result = await this.pricingModel.updateMany(
      { 'promotion.endsAt': { $lt: new Date() } },
      { $unset: { promotion: '' } },
    );
    if (result.modifiedCount > 0) {
      this.logger.log(`PromotionExpiryJob: ${result.modifiedCount} promoção(ões) expirada(s) removida(s)`);
    }
  }
}
