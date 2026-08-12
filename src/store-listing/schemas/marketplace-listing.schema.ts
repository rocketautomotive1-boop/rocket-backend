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
  @Prop({ type: Types.ObjectId, required: true, index: true })
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

MarketplaceListingSchema.index({ storeListingId: 1, marketplaceTag: 1 }, { unique: true });
