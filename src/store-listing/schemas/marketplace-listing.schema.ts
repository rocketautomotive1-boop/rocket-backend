import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MarketplaceListingDocument = HydratedDocument<MarketplaceListingModel>;

export type MarketplaceListingStatus = 'pending_creation' | 'active' | 'paused' | 'error';

/**
 * Uma publicação de um StoreListing em UM marketplace. Collection própria
 * (não array embutido no StoreListing) — cada marketplace sincroniza seu
 * próprio documento, sem lock cruzado entre workers ML/Shopee/Amazon/
 * TikTok/OLX rodando em paralelo, e sem risco de estourar o limite de 16MB
 * de documento. accountId é resolvido de store.marketplaceAccounts no
 * momento da criação (primeira publicação) — nunca "ao vivo" depois.
 */
@Schema({ collection: 'marketplace_listings', timestamps: true })
export class MarketplaceListingModel {
  /** Sem index:true aqui — o índice composto {storeListingId, marketplaceTag, externalId} abaixo já cobre queries por storeListingId sozinho (prefixo do índice composto). */
  @Prop({ type: Types.ObjectId, required: true })
  storeListingId: Types.ObjectId;

  @Prop({ required: true })
  marketplaceTag: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ type: String, default: null })
  externalId: string | null;

  @Prop({ required: true, default: 'pending_creation' })
  status: MarketplaceListingStatus;
}

export const MarketplaceListingSchema = SchemaFactory.createForClass(MarketplaceListingModel);

// Antes exigia unicidade só por (storeListingId, marketplaceTag), assumindo 1 anúncio por
// produto+marketplace — falso neste negócio: o mesmo produto vende com N títulos distintos
// por veículo compatível (limite de 60 caracteres do ML), cada um com seu próprio externalId.
// A identidade real de um anúncio é o externalId atribuído pelo marketplace, não a dupla
// (storeListingId, marketplaceTag) — por isso a unicidade só se aplica quando externalId
// existe (parcial): um MarketplaceListing pending_creation (sem externalId ainda) não colide
// com nenhum outro até ganhar um externalId real.
MarketplaceListingSchema.index(
  { storeListingId: 1, marketplaceTag: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
