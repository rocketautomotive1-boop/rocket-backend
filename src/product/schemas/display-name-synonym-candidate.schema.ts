import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DisplayNameSynonymCandidateDocument = HydratedDocument<DisplayNameSynonymCandidateModel>;

export type DisplayNameSynonymCandidateStatus = 'pending' | 'approved' | 'rejected';

/**
 * Fila de candidatos a sinônimo de displayName, minerada a partir de
 * display_name_category_hints (dois displayNames diferentes na mesma
 * categoria). Dono exclusivo: DisplayNameSynonymCandidateService.
 */
@Schema({ collection: 'display_name_synonym_candidates', timestamps: true })
export class DisplayNameSynonymCandidateModel {
    _id: string;

    @Prop({ required: true, index: true })
    termNormalized: string;

    @Prop({ required: true })
    canonicalDisplayName: string;

    @Prop({ type: Types.ObjectId, ref: 'CategoryModel', required: true, index: true })
    categoryId: Types.ObjectId;

    @Prop({ required: true })
    occurrences: number;

    @Prop({ default: 'pending', index: true })
    status: DisplayNameSynonymCandidateStatus;

    @Prop()
    reviewedAt?: Date;
}

export const DisplayNameSynonymCandidateSchema = SchemaFactory.createForClass(DisplayNameSynonymCandidateModel);

DisplayNameSynonymCandidateSchema.index({ termNormalized: 1, categoryId: 1 }, { unique: true });
