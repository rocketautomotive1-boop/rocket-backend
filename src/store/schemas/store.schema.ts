import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StoreDocument = HydratedDocument<StoreModel>;

@Schema({ _id: false })
export class MarketplaceAccountEntry {
  @Prop({ required: true })
  marketplaceTag: string;

  /** O _id de uma entrada em marketplaces.accounts[]. */
  @Prop({ required: true })
  accountId: string;
}

const MarketplaceAccountEntrySchema = SchemaFactory.createForClass(MarketplaceAccountEntry);

/**
 * Loja — agregado raiz da publicação. Dona de N contas de publicação POR
 * MARKETPLACE (uma loja pode ter mais de uma conta do mesmo marketplace) e,
 * por extensão de identidade, dona dos StoreListings que apontam para ela
 * via storeId.
 *
 * Um produto (catálogo) é compartilhado entre lojas; o que é operacional
 * (anúncio, preço, estoque, localização física) é sempre por loja. Ver
 * docs/superpowers/specs/2026-08-12-store-listing-aggregate-design.md.
 */
@Schema({ collection: 'stores', timestamps: true })
export class StoreModel {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ type: [MarketplaceAccountEntrySchema], default: [] })
  marketplaceAccounts: MarketplaceAccountEntry[];
}

export const StoreSchema = SchemaFactory.createForClass(StoreModel);
