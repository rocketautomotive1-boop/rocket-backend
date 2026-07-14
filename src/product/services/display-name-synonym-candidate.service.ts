import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoryHintModel, CategoryHintDocument } from '../schemas/category-hint.schema';
import {
    DisplayNameSynonymCandidateModel,
    DisplayNameSynonymCandidateDocument,
} from '../schemas/display-name-synonym-candidate.schema';
import { DisplayNameSynonymModel, DisplayNameSynonymDocument } from '../schemas/display-name-synonym.schema';

const MIN_OCCURRENCES_TO_ENQUEUE = 2;

/**
 * Único dono de display_name_synonym_candidates e
 * product_display_name_synonyms. Mineração: chamada por
 * CategoryHintService.recordHint após cada upsert de hint — compara o
 * displayName recém-salvo contra os demais hints da mesma categoria.
 */
@Injectable()
export class DisplayNameSynonymCandidateService {
    constructor(
        @InjectModel(CategoryHintModel.name)
        private readonly categoryHintModel: Model<CategoryHintDocument>,
        @InjectModel(DisplayNameSynonymCandidateModel.name)
        private readonly candidateModel: Model<DisplayNameSynonymCandidateDocument>,
        @InjectModel(DisplayNameSynonymModel.name)
        private readonly synonymModel: Model<DisplayNameSynonymDocument>,
    ) { }

    async checkAndEnqueue(
        displayNameNormalized: string,
        categoryId: Types.ObjectId,
        occurrences: number,
    ): Promise<void> {
        if (!displayNameNormalized || occurrences < MIN_OCCURRENCES_TO_ENQUEUE) return;

        const hintsInCategory = await this.categoryHintModel
            .find({ categoryId })
            .sort({ count: -1 })
            .lean()
            .exec();
        if (hintsInCategory.length < 2) return;

        const topHint = hintsInCategory[0];
        if (topHint.displayNameNormalized === displayNameNormalized) return;

        const canonicalDisplayName = topHint.displayNameNormalized;

        const existing = await this.candidateModel
            .findOne({ termNormalized: displayNameNormalized, categoryId })
            .lean()
            .exec();
        if (existing && existing.status !== 'pending') return;

        await this.candidateModel.findOneAndUpdate(
            { termNormalized: displayNameNormalized, categoryId },
            { $set: { canonicalDisplayName, occurrences, status: 'pending' } },
            { upsert: true },
        );
    }

    async listPending(): Promise<Array<{
        id: string;
        termNormalized: string;
        canonicalDisplayName: string;
        categoryId: string;
        occurrences: number;
    }>> {
        const candidates = await this.candidateModel
            .find({ status: 'pending' })
            .sort({ occurrences: -1 })
            .lean()
            .exec();

        return candidates.map((c) => ({
            id: String(c._id),
            termNormalized: c.termNormalized,
            canonicalDisplayName: c.canonicalDisplayName,
            categoryId: String(c.categoryId),
            occurrences: c.occurrences,
        }));
    }

    async approve(id: string): Promise<void> {
        const candidate = await this.candidateModel.findById(id).exec();
        if (!candidate) throw new NotFoundException('Candidato de sinônimo não encontrado');

        await this.synonymModel.findOneAndUpdate(
            { termNormalized: candidate.termNormalized },
            {
                $set: {
                    canonicalDisplayName: candidate.canonicalDisplayName,
                    categoryId: candidate.categoryId,
                },
            },
            { upsert: true },
        );

        candidate.status = 'approved';
        candidate.reviewedAt = new Date();
        await candidate.save();
    }

    async reject(id: string): Promise<void> {
        const candidate = await this.candidateModel.findById(id).exec();
        if (!candidate) throw new NotFoundException('Candidato de sinônimo não encontrado');

        candidate.status = 'rejected';
        candidate.reviewedAt = new Date();
        await candidate.save();
    }

    async resolveCanonical(displayNameNormalized: string): Promise<string> {
        const synonym = await this.synonymModel
            .findOne({ termNormalized: displayNameNormalized })
            .lean()
            .exec();
        return synonym?.canonicalDisplayName ?? displayNameNormalized;
    }
}
