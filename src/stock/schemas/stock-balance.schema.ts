import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockCondition } from './stock-lot.schema';

export type StockBalanceDocument = HydratedDocument<StockBalanceModel>;

/**
 * Materialized projection of stock balance per (lot × box). Source of truth is the ledger
 * (stock_movements); this is updated atomically with each movement for O(1) reads.
 * A null box represents unlocated stock.
 */
@Schema({ collection: 'stock_balances', timestamps: true })
export class StockBalanceModel {
  @Prop({ type: Types.ObjectId, ref: 'StockLotModel', required: true, index: true })
  lotId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  condition: StockCondition;

  @Prop({ type: Types.ObjectId, ref: 'BoxModel', default: null, index: true })
  boxId: Types.ObjectId | null;

  @Prop({ required: true, default: 0 })
  onHand: number;

  @Prop({ required: true, default: 0 })
  reserved: number;
}

export const StockBalanceSchema = SchemaFactory.createForClass(StockBalanceModel);
StockBalanceSchema.index({ lotId: 1, boxId: 1 }, { unique: true });
StockBalanceSchema.index({ productId: 1 });
StockBalanceSchema.index({ productId: 1, condition: 1 });
