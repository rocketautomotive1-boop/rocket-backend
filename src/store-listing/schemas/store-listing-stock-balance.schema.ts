import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockCondition } from '../../stock/schemas/stock-lot.schema';

export type StoreListingStockBalanceDocument = HydratedDocument<StoreListingStockBalanceModel>;

@Schema({ collection: 'store_listing_stock_balances', timestamps: true })
export class StoreListingStockBalanceModel {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  storeListingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  lotId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, unique: true })
  originalBalanceId: Types.ObjectId;

  @Prop({ type: String, enum: ['new', 'damaged', 'used', 'refurbished'], required: true })
  condition: StockCondition;

  @Prop({ type: Types.ObjectId, default: null })
  boxId: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  onHand: number;

  @Prop({ type: Number, default: 0 })
  reserved: number;
}

export const StoreListingStockBalanceSchema = SchemaFactory.createForClass(StoreListingStockBalanceModel);

StoreListingStockBalanceSchema.index({ storeListingId: 1, condition: 1 });
