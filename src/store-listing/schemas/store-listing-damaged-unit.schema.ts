import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type StoreListingDamagedUnitDocument = HydratedDocument<StoreListingDamagedUnitModel>;

export type DamagedUnitCondition = 'damaged' | 'used' | 'refurbished';
export type DamagedUnitStatus = 'in_stock' | 'listed' | 'sold' | 'written_off';

/**
 * Unidade avariada individual — não fungível. Cada unidade tem suas
 * próprias fotos, descrição de dano, preço e allocation física. Ver
 * docs/superpowers/specs/2026-08-12-damaged-unit-inventory-design.md.
 * status é unidirecional: in_stock -> listed -> sold, ou in_stock/listed ->
 * written_off. sold/written_off são terminais — nenhum código reabre uma
 * unidade para in_stock.
 */
@Schema({ collection: 'store_listing_damaged_units', timestamps: true })
export class StoreListingDamagedUnitModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  storeListingId: Types.ObjectId;

  /** Lote fungível de origem (store_listing_stock_lots) — rastro de custo/entrada. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  sourceLotId: Types.ObjectId;

  @Prop({ type: String, enum: ['damaged', 'used', 'refurbished'], required: true })
  condition: DamagedUnitCondition;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop({ type: String, default: '' })
  damageNotes: string;

  @Prop({ type: Types.Decimal128, default: null })
  price: Types.Decimal128 | null;

  @Prop({ type: String, enum: ['in_stock', 'listed', 'sold', 'written_off'], required: true, default: 'in_stock' })
  status: DamagedUnitStatus;
}

export const StoreListingDamagedUnitSchema = SchemaFactory.createForClass(StoreListingDamagedUnitModel);

StoreListingDamagedUnitSchema.index({ storeListingId: 1, status: 1 });
