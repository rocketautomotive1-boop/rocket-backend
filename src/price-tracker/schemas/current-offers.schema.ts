import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PriceHistoryBestOffer } from './price-history.schema';

export type CurrentOffersDocument = HydratedDocument<CurrentOffersModel>;

/** Mesmo shape de PriceHistoryBestOffer — uma linha por vendedor do ciclo. */
export type CurrentOfferEntry = PriceHistoryBestOffer;

/**
 * TODAS as ofertas do último ciclo bem-sucedido de um EAN (não histórico — 1 doc
 * por EAN, upsert a cada scan). Separado de `price_history` de propósito: guardar
 * o array completo (pode chegar a centenas de vendedores) em cada snapshot
 * histórico infaria a coleção usada para gráfico/análise sem necessidade —
 * só a lista "onde comprar agora" precisa do array cheio, e só do ciclo mais recente.
 */
@Schema({ collection: 'current_offers' })
export class CurrentOffersModel {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  ean: string;

  @Prop({ type: Date, required: true })
  scannedAt: Date;

  @Prop({ type: [Object], default: [] })
  offers: CurrentOfferEntry[];
}

export const CurrentOffersSchema = SchemaFactory.createForClass(CurrentOffersModel);
