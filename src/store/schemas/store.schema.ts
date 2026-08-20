import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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
 * Configuração fiscal por canal de venda (marketplaceTag+accountId) desta
 * loja: qual série NFe usar, o contador atômico dessa série e o sellerId
 * reportado no XML (infIntermed.idCadIntTran). Série deve ser única dentro
 * da mesma LegalEntity — validado em StoreService.setFiscalChannel, não é
 * indexável em array pelo MongoDB.
 */
@Schema({ _id: false })
export class FiscalChannel {
  @Prop({ required: true })
  marketplaceTag: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true })
  series: number;

  /** Último número reservado. Próximo número = counter (após $inc atômico). */
  @Prop({ default: 0 })
  counter: number;

  @Prop()
  reservedAt?: Date;

  /** idCadIntTran — ID do vendedor cadastrado no marketplace, para infIntermed. */
  @Prop()
  marketplaceSellerId?: string;
}

const FiscalChannelSchema = SchemaFactory.createForClass(FiscalChannel);

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

  /** Entidade legal (CNPJ) que emite as NFes das vendas desta loja. */
  @Prop({ type: Types.ObjectId, ref: 'LegalEntityModel', default: null })
  legalEntityId: Types.ObjectId | null;

  @Prop({ type: [FiscalChannelSchema], default: [] })
  fiscalChannels: FiscalChannel[];
}

export const StoreSchema = SchemaFactory.createForClass(StoreModel);
