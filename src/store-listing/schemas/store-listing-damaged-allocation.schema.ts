import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type StoreListingDamagedAllocationDocument = HydratedDocument<StoreListingDamagedAllocationModel>;

/**
 * Allocation individual de uma unidade avariada — 1:1, ao contrário da
 * allocation de lote fungível (que pode ter N allocations por lote em
 * store_listing_stock_balances.boxId). warehouseId precisa pertencer à
 * mesma loja do StoreListing dono da unidade — validado em
 * StoreListingService, não aqui no schema.
 */
@Schema({ collection: 'store_listing_damaged_allocations', timestamps: true })
export class StoreListingDamagedAllocationModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  damagedUnitId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  warehouseId: Types.ObjectId;

  @Prop({ type: String })
  position?: string;
}

export const StoreListingDamagedAllocationSchema = SchemaFactory.createForClass(
  StoreListingDamagedAllocationModel,
);

StoreListingDamagedAllocationSchema.index({ damagedUnitId: 1 }, { unique: true });
