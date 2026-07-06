import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PriceHistoryDocument = HydratedDocument<PriceHistoryModel>;

export interface PriceHistoryStats {
  min: number | null;
  avg: number | null;
  max: number | null;
  median: number | null;
  count: number;
}

export interface PriceHistoryBestOffer {
  price: number | null;
  listPrice: number | null;
  savings: number | null;
  sellerName: string | null;
  address: string | null;
  bairro: string | null;
  distKm: number | null;
  soldAt: string | null;
  soldAgo: string | null;
}

/**
 * 1 doc por (EAN x ciclo de scan), append-only. Ciclo que falhou também é registrado
 * (com `error`) — fica visível no gráfico e fora da média móvel.
 * Coleção NORMAL (não time-series): volume minúsculo e sem restrições de índice.
 */
@Schema({ collection: 'price_history' })
export class PriceHistoryModel {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true })
  ean: string;

  @Prop({ type: Date, required: true })
  scannedAt: Date;

  @Prop({ type: Object, default: null })
  stats?: PriceHistoryStats | null;

  /** Menor preço do ciclo, achatado (loja/bairro/distância). */
  @Prop({ type: Object, default: null })
  bestOffer?: PriceHistoryBestOffer | null;

  @Prop({ type: String, default: null })
  error?: string | null;
}

export const PriceHistorySchema = SchemaFactory.createForClass(PriceHistoryModel);

// Toda leitura é por EAN ordenada por tempo (média móvel, gráfico, último snapshot).
PriceHistorySchema.index({ ean: 1, scannedAt: -1 });
