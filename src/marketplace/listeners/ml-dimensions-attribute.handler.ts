import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../../product/schemas/product.schema';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MlDimensionsCalculatorService } from '../services/ml-dimensions-calculator.service';
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
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    private readonly calculator: MlDimensionsCalculatorService,
  ) {}

  @OnEvent(PRODUCT_EVENTS.UPDATED, { async: true })
  async handle(event: ProductUpdatedEvent): Promise<void> {
    const dimensionsChanged =
      event.changedFields.includes('weight') ||
      event.changedFields.includes('dimensions');

    if (!dimensionsChanged) return;
    if (!event.snapshot.dimensions || event.snapshot.weight == null) return;

    try {
      // 1. Check product exists before any other query
      const product = await this.productModel
        .findById(event.productId, { attributes: 1 })
        .lean()
        .exec();

      if (!product) return;

      // 2. Resolve ML marketplace
      const mlMarketplace = await this.marketplaceModel
        .findOne({ name: 'Mercado Livre' })
        .lean()
        .exec();

      if (!mlMarketplace) return;

      const mpId = mlMarketplace._id as Types.ObjectId;
      const calculated = this.calculator.calculate(
        event.snapshot.dimensions,
        event.snapshot.weight,
      );

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
