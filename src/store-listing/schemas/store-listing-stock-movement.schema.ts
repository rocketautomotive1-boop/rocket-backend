import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { StockCondition } from '../../stock/schemas/stock-lot.schema';
import { StockMovementType } from '../../stock/domain/movement-type';

export type StoreListingStockMovementDocument = HydratedDocument<StoreListingStockMovementModel>;

@Schema({ collection: 'store_listing_stock_movements', timestamps: true })
export class StoreListingStockMovementModel {
  /**
   * Sem index:true aqui — o índice composto {storeListingId, date} abaixo já cobre queries por
   * storeListingId sozinho (prefixo do índice composto).
   *
   * type: MongooseSchema.Types.ObjectId (não mongoose.Types.ObjectId) — achado nesta sessão:
   * o construtor de instância Types.ObjectId não é reconhecido como tipo de schema nesta versão
   * do Mongoose e o campo silenciosamente vira Mixed, quebrando cast automático de string→ObjectId
   * em find()/queries. Mesmo bug existe em outros schemas do projeto (fora de escopo aqui).
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  storeListingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  lotId?: Types.ObjectId;

  /**
   * Referência ao StockMovementModel de origem — presente apenas em
   * movimentos migrados pelo backfill da Fase 2. Movimentos criados via
   * dual-write (Fase 3, tráfego ao vivo) não têm um StockMovementModel de
   * origem — o campo fica ausente, não um placeholder. Índice único esparso:
   * garante unicidade entre os documentos migrados (nunca duplica um mesmo
   * originalMovementId), mas não aplica nenhuma constraint entre documentos
   * onde o campo está ausente.
   */
  @Prop({ type: Types.ObjectId, unique: true, sparse: true })
  originalMovementId?: Types.ObjectId;

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
