import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StoreListingDocument = HydratedDocument<StoreListingModel>;

/**
 * Aggregate root: "este produto, vendido por esta loja". Documento enxuto —
 * identidade e agregação, não dados de alto volume. Estoque, publicações por
 * marketplace, allocation, etc. vivem em collections próprias referenciando
 * storeListingId (nunca embutidas aqui) — ver
 * docs/superpowers/specs/2026-08-12-store-listing-aggregate-design.md.
 *
 * productId/storeId são ObjectIds opacos: este módulo nunca importa
 * ProductModule nem StoreModule para validar/ler esses IDs.
 */
@Schema({ collection: 'store_listings', timestamps: true })
export class StoreListingModel {
  @Prop({ type: Types.ObjectId, required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  storeId: Types.ObjectId;
}

export const StoreListingSchema = SchemaFactory.createForClass(StoreListingModel);

StoreListingSchema.index({ productId: 1, storeId: 1 }, { unique: true });
