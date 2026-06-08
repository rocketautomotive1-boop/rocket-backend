import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductPricingDocument = HydratedDocument<ProductPricingModel>;

@Schema({ _id: false })
export class PriceOverrideEntry {
  @Prop({ type: Types.ObjectId, required: true })
  marketplaceId: Types.ObjectId;

  @Prop({ type: Types.Decimal128, required: true })
  price: Types.Decimal128;
}
const PriceOverrideSchema = SchemaFactory.createForClass(PriceOverrideEntry);

/**
 * Sale-price record for a product, owned by PricingModule. basePrice is the default; `overrides`
 * are per-marketplace pricing rules. Cost lives on the stock lot — never here.
 */
@Schema({ collection: 'product_pricing', timestamps: true })
export class ProductPricingModel {
  @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, unique: true, index: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.Decimal128, default: () => Types.Decimal128.fromString('0') })
  basePrice: Types.Decimal128;

  @Prop({ type: [PriceOverrideSchema], default: [] })
  overrides: PriceOverrideEntry[];

  @Prop({ type: Types.Decimal128 })
  listPrice?: Types.Decimal128; // "de-por" display price

  @Prop({ type: Object })
  meta?: { markup?: number; profitMargin?: number; strategy?: string };
}

export const ProductPricingSchema = SchemaFactory.createForClass(ProductPricingModel);
