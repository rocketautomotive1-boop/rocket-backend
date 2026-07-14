import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoryHintModel, CategoryHintDocument } from '../schemas/category-hint.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { DisplayNameSynonymCandidateService } from './display-name-synonym-candidate.service';

/**
 * Único dono da coleção display_name_category_hints. Não conhece árvore de
 * categorias, ML, nem IA — só grava/lê a contagem displayName -> categoria.
 * Ver docs/superpowers/specs/2026-07-13-product-display-name-category-hint-design.md.
 */
@Injectable()
export class CategoryHintService {
    constructor(
        @InjectModel(CategoryHintModel.name)
        private readonly categoryHintModel: Model<CategoryHintDocument>,
        @InjectModel(CategoryModel.name)
        private readonly categoryModel: Model<CategoryDocument>,
        private readonly displayNameSynonymCandidateService: DisplayNameSynonymCandidateService,
    ) { }

    private normalize(displayName: string): string {
        return displayName.trim().toLowerCase();
    }

    async recordHint(displayName: string, categoryId: string): Promise<void> {
        const displayNameNormalized = this.normalize(displayName);
        if (!displayNameNormalized || !Types.ObjectId.isValid(categoryId)) return;

        const categoryObjectId = new Types.ObjectId(categoryId);
        const hint = await this.categoryHintModel.findOneAndUpdate(
            { displayNameNormalized, categoryId: categoryObjectId },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true, new: true },
        );

        await this.displayNameSynonymCandidateService.checkAndEnqueue(
            displayNameNormalized,
            categoryObjectId,
            hint.count,
        );
    }

    async suggestCategory(
        displayName: string,
    ): Promise<{ categoryId: string; categoryName: string; count: number } | null> {
        const rawNormalized = this.normalize(displayName);
        if (!rawNormalized) return null;

        const displayNameNormalized = await this.displayNameSynonymCandidateService.resolveCanonical(rawNormalized);

        const topHint = await this.categoryHintModel
            .findOne({ displayNameNormalized })
            .sort({ count: -1 })
            .lean()
            .exec();

        if (!topHint) return null;

        const category = await this.categoryModel
            .findById(topHint.categoryId)
            .select('name')
            .lean()
            .exec();

        if (!category) return null;

        return {
            categoryId: String(topHint.categoryId),
            categoryName: category.name,
            count: topHint.count,
        };
    }
}
