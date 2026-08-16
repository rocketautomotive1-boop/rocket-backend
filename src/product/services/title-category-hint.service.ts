import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TitleCategoryHintModel, TitleCategoryHintDocument } from '../schemas/title-category-hint.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';

/**
 * Único dono de title_category_hints. Substitui CategoryHintService:
 * titleId já é canônico (ProductShortTitleService resolve sinônimos antes
 * de chegar aqui), então não há mineração/fila de candidatos — só a
 * contagem direta titleId -> categoria.
 */
@Injectable()
export class TitleCategoryHintService {
    constructor(
        @InjectModel(TitleCategoryHintModel.name)
        private readonly titleCategoryHintModel: Model<TitleCategoryHintDocument>,
        @InjectModel(CategoryModel.name)
        private readonly categoryModel: Model<CategoryDocument>,
    ) { }

    async recordHint(titleId: string, categoryId: string): Promise<void> {
        if (!Types.ObjectId.isValid(titleId) || !Types.ObjectId.isValid(categoryId)) return;

        await this.titleCategoryHintModel.findOneAndUpdate(
            { titleId: new Types.ObjectId(titleId), categoryId: new Types.ObjectId(categoryId) },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true, new: true },
        );
    }

    /**
     * Só sugere com confiança mínima (count >= 2) e sem ambiguidade (o segundo colocado,
     * se houver, não pode empatar em count com o primeiro) — evita auto-aplicar categoria
     * errada em títulos genéricos que hoje se dividem entre 2+ categorias (ex: "Farol").
     */
    async suggestCategory(
        titleId: string,
    ): Promise<{ categoryId: string; categoryName: string; count: number } | null> {
        if (!Types.ObjectId.isValid(titleId)) return null;

        const topHints = await this.titleCategoryHintModel
            .find({ titleId: new Types.ObjectId(titleId) })
            .sort({ count: -1 })
            .limit(2)
            .lean()
            .exec();

        const [topHint, runnerUp] = topHints;
        if (!topHint || topHint.count < 2) return null;
        if (runnerUp && runnerUp.count >= topHint.count) return null;

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

    /** Remove um hint específico — usado quando o ML rejeita a categoria (moderation WRONG_CATEGORY),
     * pra não reforçar um par titleId->categoria já comprovado errado. */
    async invalidateHint(titleId: string, categoryId: string): Promise<void> {
        if (!Types.ObjectId.isValid(titleId) || !Types.ObjectId.isValid(categoryId)) return;

        await this.titleCategoryHintModel.deleteOne({
            titleId: new Types.ObjectId(titleId),
            categoryId: new Types.ObjectId(categoryId),
        });
    }
}
