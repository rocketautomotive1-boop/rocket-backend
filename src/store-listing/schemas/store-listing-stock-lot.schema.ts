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
  /** Sem index:true aqui — o índice composto {storeListingId, condition} abaixo já cobre queries por storeListingId sozinho (prefixo do índice composto). */
  @Prop({ type: Types.ObjectId, required: true })
  storeListingId: Types.ObjectId;

  /**
   * Referência ao StockLotModel de origem — presente apenas em lotes migrados
   * pelo backfill da Fase 2. Lotes criados via dual-write (Fase 3, tráfego ao
   * vivo) não têm um StockLotModel de origem — o campo fica ausente, não um
   * placeholder. Índice único esparso: garante unicidade entre os documentos
   * migrados (nunca duplica um mesmo originalLotId), mas não aplica nenhuma
   * constraint entre documentos onde o campo está ausente.
   */
  @Prop({ type: Types.ObjectId, unique: true, sparse: true })
  originalLotId?: Types.ObjectId;

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
