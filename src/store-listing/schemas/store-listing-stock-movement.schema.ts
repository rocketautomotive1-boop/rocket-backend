import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockCondition } from '../../stock/schemas/stock-lot.schema';
import { StockMovementType } from '../../stock/domain/movement-type';

export type StoreListingStockMovementDocument = HydratedDocument<StoreListingStockMovementModel>;

@Schema({ collection: 'store_listing_stock_movements', timestamps: true })
export class StoreListingStockMovementModel {
  /** Sem index:true aqui — o índice composto {storeListingId, date} abaixo já cobre queries por storeListingId sozinho (prefixo do índice composto). */
  @Prop({ type: Types.ObjectId, required: true })
  storeListingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  lotId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, unique: true })
  originalMovementId: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  orderId?: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(StockMovementType) })
  type: StockMovementType;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true, default: Date.now })
  date: Date;

  @Prop({ type: Types.Decimal128 })
  unitCost?: Types.Decimal128;

  @Prop({ type: Types.ObjectId })
  fromBoxId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  toBoxId?: Types.ObjectId;

  @Prop({ type: String, enum: ['new', 'damaged', 'used', 'refurbished'], default: 'new' })
  condition: StockCondition;

  @Prop({ type: String })
  reason?: string;

  @Prop({ type: Object })
  origin?: { type: string; location: string };

  @Prop({ type: Object })
  metadata?: { operator?: string; externalReference?: string; [k: string]: any };
}

export const StoreListingStockMovementSchema = SchemaFactory.createForClass(StoreListingStockMovementModel);

StoreListingStockMovementSchema.index({ storeListingId: 1, date: -1 });
