import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockLotDocument = HydratedDocument<StockLotModel>;

export type StockCondition = 'new' | 'damaged' | 'used' | 'refurbished';

/**
 * A real lot of stock for a product, scoped by commercial condition. The lot is where the
 * COST lives (each lot can have its own unit cost). Sale price never lives here.
 */
@Schema({ collection: 'stock_lots', timestamps: true })
export class StockLotModel {
  @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ required: true, default: 'new' })
  condition: StockCondition;

  @Prop({ type: Types.Decimal128, required: true, default: () => Types.Decimal128.fromString('0') })
  unitCost: Types.Decimal128;

  @Prop({ type: Date })
  expiryDate?: Date;

  @Prop()
  sourceRef?: string; // NF / purchase reference
}

export const StockLotSchema = SchemaFactory.createForClass(StockLotModel);
StockLotSchema.index({ productId: 1, condition: 1 });
