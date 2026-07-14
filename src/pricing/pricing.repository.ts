import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductPricingModel, ProductPricingDocument } from './schemas/product-pricing.schema';

@Injectable()
export class PricingRepository {
  constructor(
    @InjectModel(ProductPricingModel.name) public readonly model: Model<ProductPricingDocument>,
  ) {}

  findByProduct(productId: string) {
    return this.model.findOne({ productId: new Types.ObjectId(productId) }).lean().exec();
  }

  findByProducts(productIds: string[]) {
    return this.model
      .find({ productId: { $in: productIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
  }

  upsertBase(productId: string, basePrice: Types.Decimal128) {
    return this.model
      .updateOne(
        { productId: new Types.ObjectId(productId) },
        { $set: { basePrice } },
        { upsert: true },
      )
      .exec();
  }

  async upsertOverride(productId: string, marketplaceId: string, price: Types.Decimal128) {
    const pid = new Types.ObjectId(productId);
    const mid = new Types.ObjectId(marketplaceId);
    await this.model.bulkWrite([
      { updateOne: { filter: { productId: pid }, update: { $setOnInsert: { productId: pid } }, upsert: true } },
      { updateOne: { filter: { productId: pid }, update: { $pull: { overrides: { marketplaceId: mid } } } } },
      { updateOne: { filter: { productId: pid }, update: { $push: { overrides: { marketplaceId: mid, price } } } } },
    ]);
  }

  clearOverride(productId: string, marketplaceId: string) {
    return this.model
      .updateOne(
        { productId: new Types.ObjectId(productId) },
        { $pull: { overrides: { marketplaceId: new Types.ObjectId(marketplaceId) } } },
      )
      .exec();
  }

  upsertMeta(productId: string, meta: any) {
    return this.model
      .updateOne({ productId: new Types.ObjectId(productId) }, { $set: { meta } }, { upsert: true })
      .exec();
  }

  upsertPromotion(productId: string, promotion: { listPrice: Types.Decimal128; startsAt: Date; endsAt: Date }) {
    return this.model
      .updateOne(
        { productId: new Types.ObjectId(productId) },
        { $set: { promotion } },
        { upsert: true },
      )
      .exec();
  }

  clearPromotion(productId: string) {
    return this.model
      .updateOne({ productId: new Types.ObjectId(productId) }, { $unset: { promotion: '' } })
      .exec();
  }

  /** Produtos com promoção vigente agora — usado pelo rail "deals". */
  findActivePromotionProductIds(now: Date = new Date()) {
    return this.model
      .find({ 'promotion.startsAt': { $lte: now }, 'promotion.endsAt': { $gte: now } })
      .select('productId')
      .lean()
      .exec();
  }
}
