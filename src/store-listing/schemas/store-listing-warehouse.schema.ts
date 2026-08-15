import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type StoreListingWarehouseDocument = HydratedDocument<StoreListingWarehouseModel>;

/**
 * Depósito físico de uma loja. Pertence à loja (storeId), não a um
 * StoreListing individual — várias fichas de produto da mesma loja
 * compartilham os mesmos depósitos. Referenciado por
 * store_listing_stock_balances.boxId (existente, sem mudança de tipo) e
 * por store_listing_damaged_allocations.warehouseId (novo).
 */
@Schema({ collection: 'store_listing_warehouses', timestamps: true })
export class StoreListingWarehouseModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  storeId: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String })
  address?: string;
}

export const StoreListingWarehouseSchema = SchemaFactory.createForClass(StoreListingWarehouseModel);

StoreListingWarehouseSchema.index({ storeId: 1, name: 1 }, { unique: true });
