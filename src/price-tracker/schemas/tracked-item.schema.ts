import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TrackedItemDocument = HydratedDocument<TrackedItemModel>;

/**
 * Item monitorado pelo Caçador de Promoções. Lista LIVRE (não vinculada ao catálogo),
 * single-user: 1 item por EAN (índice único) — o dedupe do ciclo de scan cai de graça.
 */
@Schema({ collection: 'tracked_items', timestamps: true })
export class TrackedItemModel {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  ean: string;

  /**
   * Nome do produto. Preenchido automaticamente pelo scan (campo `desc` da API do
   * Menor Preço) quando vazio; o usuário pode renomear via PATCH.
   */
  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: Boolean, default: true, index: true })
  active: boolean;

  /** Teto: alerta se preço atual <= isto (funciona desde o 1º ciclo). */
  @Prop({ type: Number, default: null })
  targetPrice?: number | null;

  /** Alerta se preço <= média móvel 14d * (1 - pct/100). */
  @Prop({ type: Number, default: 15 })
  discountThresholdPct: number;

  /** Máquina de estado do cooldown: setado ao ENTRAR em oferta, limpo ao sair. */
  @Prop({ type: Date, default: null })
  inDealSince?: Date | null;

  @Prop({ type: Date, default: null })
  lastAlertAt?: Date | null;

  /** Preço do último alerta — re-alerta só se cair mais 5% abaixo dele. */
  @Prop({ type: Number, default: null })
  lastAlertPrice?: number | null;

  /** Categoria livre (tracked_categories); null = sem categoria ("Todas"). */
  @Prop({ type: Types.ObjectId, ref: 'TrackedCategoryModel', default: null, index: true })
  categoryId?: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const TrackedItemSchema = SchemaFactory.createForClass(TrackedItemModel);
