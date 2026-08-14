import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockCondition } from '../domain/condition';

export type ProductPricingDocument = HydratedDocument<ProductPricingModel>;

@Schema({ _id: false })
export class PriceOverrideEntry {
  @Prop({ type: Types.ObjectId, required: true })
  marketplaceId: Types.ObjectId;

  @Prop({ type: Types.Decimal128, required: true })
  price: Types.Decimal128;
}
const PriceOverrideSchema = SchemaFactory.createForClass(PriceOverrideEntry);

@Schema({ _id: false })
export class ConditionPriceEntry {
  @Prop({ required: true })
  condition: string; // 'damaged' | 'used' | 'refurbished'

  @Prop({ type: Types.Decimal128, required: true })
  price: Types.Decimal128;
}
const ConditionPriceSchema = SchemaFactory.createForClass(ConditionPriceEntry);

@Schema({ _id: false })
export class ConditionOverrideEntry {
  @Prop({ required: true })
  condition: string;

  @Prop({ type: Types.ObjectId, required: true })
  marketplaceId: Types.ObjectId;

  @Prop({ type: Types.Decimal128, required: true })
  price: Types.Decimal128;
}
const ConditionOverrideSchema = SchemaFactory.createForClass(ConditionOverrideEntry);

@Schema({ _id: false })
export class PromotionEntry {
  @Prop({ type: Types.Decimal128, required: true })
  listPrice: Types.Decimal128; // preço "de" — sempre > preço efetivo no momento em que foi setado

  @Prop({ required: true })
  startsAt: Date;

  @Prop({ required: true })
  endsAt: Date;
}
const PromotionSchema = SchemaFactory.createForClass(PromotionEntry);

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

  @Prop({ type: [ConditionPriceSchema], default: [] })
  conditionPrices: ConditionPriceEntry[];

  @Prop({ type: [ConditionOverrideSchema], default: [] })
  conditionOverrides: ConditionOverrideEntry[];

  /**
   * Preço "de-por" com vigência — substituiu o antigo campo solto `listPrice`. Só exibição
   * (não afeta getEffectivePrice); expira sozinho via PromotionExpiryJob. Ver
   * docs/superpowers/specs/2026-07-13-offers-system-design.md.
   */
  @Prop({ type: PromotionSchema })
  promotion?: PromotionEntry;

  @Prop({ type: Object })
  meta?: { markup?: number; profitMargin?: number; strategy?: string };
}

export const ProductPricingSchema = SchemaFactory.createForClass(ProductPricingModel);

// Rail "deals" (produtos com promoção vigente) e PromotionExpiryJob.
ProductPricingSchema.index({ 'promotion.endsAt': 1 });
