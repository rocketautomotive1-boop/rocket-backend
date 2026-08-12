import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StockCondition } from '../../stock/schemas/stock-lot.schema';

export type StoreListingStockLotDocument = HydratedDocument<StoreListingStockLotModel>;

/**
 * Espelha stock/schemas/stock-lot.schema.ts trocando productId por
 * storeListingId. originalLotId referencia o StockLotModel de origem —
 * usado como chave de idempotência pelo script de backfill (Fase 2) e
 * como rastro de proveniência (não removido depois).
 */
@Schema({ collection: 'store_listing_stock_lots', timestamps: true })
export class StoreListingStockLotModel {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  storeListingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, unique: true })
  originalLotId: Types.ObjectId;

  @Prop({ type: String, enum: ['new', 'damaged', 'used', 'refurbished'], default: 'new' })
  condition: StockCondition;

  @Prop({ type: Types.Decimal128, default: () => Types.Decimal128.fromString('0') })
  unitCost: Types.Decimal128;

  @Prop({ type: Date })
  expiryDate?: Date;

  @Prop({ type: String })
  sourceRef?: string;
}

export const StoreListingStockLotSchema = SchemaFactory.createForClass(StoreListingStockLotModel);

StoreListingStockLotSchema.index({ storeListingId: 1, condition: 1 });
