import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../../product/schemas/product.schema';
import { MlDimensionsCalculatorService } from '../services/ml-dimensions-calculator.service';
import { MarketplaceConfigCacheService } from '../services/marketplace-config-cache.service';
import { PRODUCT_EVENTS, ProductUpdatedEvent } from '../../product/events/product.events';

const ML_DIMENSION_KEYS = [
  'SELLER_PACKAGE_HEIGHT',
  'SELLER_PACKAGE_WIDTH',
  'SELLER_PACKAGE_LENGTH',
  'SELLER_PACKAGE_WEIGHT',
] as const;

@Injectable()
export class MlDimensionsAttributeHandler {
  private readonly logger = new Logger(MlDimensionsAttributeHandler.name);

  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly configCache: MarketplaceConfigCacheService,
    private readonly calculator: MlDimensionsCalculatorService,
  ) {}

  @OnEvent(PRODUCT_EVENTS.UPDATED, { async: true })
  async handle(event: ProductUpdatedEvent): Promise<void> {
    const dimensionsChanged =
      event.changedFields.includes('weight') ||
      event.changedFields.includes('dimensions');

    if (!dimensionsChanged) return;

    try {
      const product = await this.productModel
        .findById(event.productId, { attributes: 1, weight: 1, dimensions: 1 })
        .lean()
        .exec();

      if (!product) return;

      const mlMarketplace = await this.configCache.getByName('Mercado Livre');

      if (!mlMarketplace) return;

      const mpId = mlMarketplace._id as Types.ObjectId;

      const weightKg =
        event.snapshot.weight != null
          ? event.snapshot.weight
          : parseFloat(String(product.weight ?? '0'));

      const dims = event.snapshot.dimensions ?? {
        height: parseFloat(String((product.dimensions as any)?.height ?? '0')),
        width:  parseFloat(String((product.dimensions as any)?.width  ?? '0')),
        length: parseFloat(String((product.dimensions as any)?.length ?? '0')),
      };

      if (!weightKg || !dims.height || !dims.width || !dims.length) return;

      const calculated = this.calculator.calculate(dims, weightKg);

      const existingAttrs: any[] = product.attributes ?? [];

      const kept = existingAttrs.filter(
        (a: any) =>
          !(String(a.marketplaceId) === String(mpId) &&
            ML_DIMENSION_KEYS.includes(a.code)),
      );

      const newDimAttrs = ML_DIMENSION_KEYS.map(code => ({
        code,
        name: code,
        value: calculated[code],
        marketplaceId: mpId,
      }));

      await this.productModel.findByIdAndUpdate(
        event.productId,
        { $set: { attributes: [...kept, ...newDimAttrs] } },
        { new: false },
      );

      this.logger.debug(
        `[MlDimensionsAttributeHandler] Updated SELLER_PACKAGE_* for product ${event.productId}`,
      );
    } catch (err) {
      this.logger.error(
        `[MlDimensionsAttributeHandler] Failed for product ${event.productId}: ${(err as Error).message}`,
      );
    }
  }
}
