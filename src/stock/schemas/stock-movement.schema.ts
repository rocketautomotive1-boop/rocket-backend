import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockMovementType } from '../domain/movement-type';
import { StockCondition } from './stock-lot.schema';

export type StockMovementDocument = HydratedDocument<StockMovementModel>;

/**
 * Immutable append-only ledger. Source of truth for all stock balances. The reconciler
 * re-aggregates this to materialize/repair StockBalance. `unitCost` is the lot cost snapshot
 * — NEVER a sale price.
 */
@Schema({ collection: 'stock_movements', timestamps: true })
export class StockMovementModel {
  @Prop({ type: Types.ObjectId, ref: 'StockLotModel', index: true })
  lotId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductModel', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrderModel', index: true })
  orderId?: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(StockMovementType) })
  type: StockMovementType;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true, default: () => new Date() })
  date: Date;

  @Prop({ type: Types.Decimal128 })
  unitCost?: Types.Decimal128;

  @Prop({ type: Types.ObjectId, ref: 'BoxModel' })
  fromBoxId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'BoxModel' })
  toBoxId?: Types.ObjectId;

  @Prop({ default: 'new' })
  condition: StockCondition;

  @Prop()
  reason?: string;

  @Prop({ type: Object })
  origin?: { type: string; location: string };

  @Prop({ type: Object })
  metadata?: { operator?: string; externalReference?: string; [k: string]: any };
}

export const StockMovementSchema = SchemaFactory.createForClass(StockMovementModel);
StockMovementSchema.index({ productId: 1, date: -1 });
StockMovementSchema.index({ lotId: 1, date: -1 });
// Idempotency (preserved from the legacy product schema)
StockMovementSchema.index(
  { 'metadata.externalReference': 1, productId: 1, type: 1 },
  { unique: true, sparse: true },
);
