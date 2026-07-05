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

  /** Apelido dado pelo usuário ("Coca-Cola lata 350ml"). */
  @Prop({ type: String, required: true })
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

  createdAt: Date;
  updatedAt: Date;
}

export const TrackedItemSchema = SchemaFactory.createForClass(TrackedItemModel);
