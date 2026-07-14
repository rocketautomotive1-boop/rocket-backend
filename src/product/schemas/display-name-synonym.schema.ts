import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DisplayNameSynonymDocument = HydratedDocument<DisplayNameSynonymModel>;

/**
 * Sinônimos de displayName de produto (ex: "painel de porta" -> "forro de
 * porta"), aprovados a partir de display-name-synonym-candidate. Dono
 * exclusivo: DisplayNameSynonymCandidateService.
 */
@Schema({ collection: 'product_display_name_synonyms', timestamps: true })
export class DisplayNameSynonymModel {
    _id: string;

    @Prop({ required: true, unique: true, index: true })
    termNormalized: string;

    @Prop({ required: true })
    canonicalDisplayName: string;

    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', required: true })
    categoryId: Types.ObjectId;
}

export const DisplayNameSynonymSchema = SchemaFactory.createForClass(DisplayNameSynonymModel);
