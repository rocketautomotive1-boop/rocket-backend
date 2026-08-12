import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StoreDocument = HydratedDocument<StoreModel>;

/**
 * Loja — agregado raiz da publicação. Dona da conta de publicação POR
 * MARKETPLACE (multi-client) e, por extensão de identidade, dona dos
 * listings/estoque/allocations que apontam para ela via storeId.
 *
 * Um produto (catálogo) é compartilhado entre lojas; o que é operacional
 * (anúncio, preço, estoque, localização física) é sempre por loja. Ver
 * docs/superpowers/specs/2026-08-12-store-as-aggregate-root-design.md.
 */
@Schema({ collection: 'stores', timestamps: true })
export class StoreModel {
  @Prop({ required: true, unique: true })
  name: string;

  /** marketplaceTag → accountId (o _id de uma entrada em marketplaces.accounts[]). */
  @Prop({ type: Object, default: {} })
  accounts: Record<string, string>;
}

export const StoreSchema = SchemaFactory.createForClass(StoreModel);
