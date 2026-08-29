import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { StockCondition } from '../../stock-shared/movement-type';

export type StoreListingStockBalanceDocument = HydratedDocument<StoreListingStockBalanceModel>;

@Schema({ collection: 'store_listing_stock_balances', timestamps: true })
export class StoreListingStockBalanceModel {
  /**
   * Sem index:true aqui — o índice composto {storeListingId, condition} abaixo já cobre queries
   * por storeListingId sozinho (prefixo do índice composto).
   *
   * type: MongooseSchema.Types.ObjectId (não mongoose.Types.ObjectId) — ver nota equivalente em
   * store-listing-stock-movement.schema.ts.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  storeListingId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  lotId: Types.ObjectId;

  /**
   * Referência ao StockBalanceModel de origem — presente apenas em saldos
   * migrados pelo backfill da Fase 2. Saldos criados via dual-write (Fase 3,
   * tráfego ao vivo) não têm um StockBalanceModel de origem — o campo fica
   * ausente, não um placeholder. Índice único esparso: garante unicidade
   * entre os documentos migrados (nunca duplica um mesmo originalBalanceId),
   * mas não aplica nenhuma constraint entre documentos onde o campo está
   * ausente.
   */
  @Prop({ type: Types.ObjectId, unique: true, sparse: true })
  originalBalanceId?: Types.ObjectId;

  @Prop({ type: String, enum: ['new', 'damaged', 'used', 'refurbished'], required: true })
  condition: StockCondition;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  boxId: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  onHand: number;

  @Prop({ type: Number, default: 0 })
  reserved: number;
}

export const StoreListingStockBalanceSchema = SchemaFactory.createForClass(StoreListingStockBalanceModel);

StoreListingStockBalanceSchema.index({ storeListingId: 1, condition: 1 });
