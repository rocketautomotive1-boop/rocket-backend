import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PriceHistoryBestOffer } from './price-history.schema';

export type PriceAlertDocument = HydratedDocument<PriceAlertModel>;

export type PriceAlertReason = 'below_moving_avg' | 'below_target' | 'all_time_low';

/** Registro de cada alerta disparado — alimenta a aba "ofertas agora" e o cooldown. */
@Schema({ collection: 'price_alerts' })
export class PriceAlertModel {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  itemId: Types.ObjectId;

  @Prop({ type: String, required: true })
  ean: string;

  @Prop({ type: Date, required: true, index: true })
  triggeredAt: Date;

  @Prop({ type: String, required: true })
  reason: PriceAlertReason;

  @Prop({ type: Number, required: true })
  currentPrice: number;

  @Prop({ type: Number, default: null })
  movingAvg?: number | null;

  @Prop({ type: Number, default: null })
  targetPrice?: number | null;

  @Prop({ type: Object, default: null })
  bestOffer?: PriceHistoryBestOffer | null;
}

export const PriceAlertSchema = SchemaFactory.createForClass(PriceAlertModel);
