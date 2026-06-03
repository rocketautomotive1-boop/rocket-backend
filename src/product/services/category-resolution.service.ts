import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoryModel } from '../schemas/category.schema';

@Injectable()
export class CategoryResolutionService {
    private readonly logger = new Logger(CategoryResolutionService.name);

    constructor(
        @InjectModel(CategoryModel.name)
        private readonly categoryModel: Model<CategoryModel>,
    ) {}

    /**
     * Resolve a categoria interna pelo category_id do marketplace (ex.: "MLB264201")
     * via `marketplaceMappings.externalId`. É o caminho MAIS ASSERTIVO (1:1 pelo id
     * do ML), preferível ao match por path/breadcrumb (texto). Retorna null se não
     * houver mapping — nesse caso o auto-cadastro por IA (futuro) entra no frontend.
     */
    async resolveByExternalId(mlCategoryId: string | null): Promise<Types.ObjectId | null> {
        if (!mlCategoryId?.trim()) return null;
        const byExternal = await this.categoryModel.findOne({
            'marketplaceMappings.externalId': mlCategoryId.trim(),
            active: true,
        });
        if (byExternal) {
            this.logger.debug(`Category resolved by externalId: ${mlCategoryId} → ${byExternal._id}`);
            return byExternal._id as Types.ObjectId;
        }
        this.logger.debug(`No category mapping for externalId: ${mlCategoryId}`);
        return null;
    }

    /**
     * Resolve a categoryPath string (ex: "Autopeças > Filtros > Filtro de Óleo")
     * to a CategoryModel _id using 3-level matching strategy.
     * Returns null if no match found.
     */
    async resolve(categoryPath: string | null): Promise<Types.ObjectId | null> {
        if (!categoryPath?.trim()) return null;

        // Level 1: exact match by marketplaceMappings[].path
        const byPath = await this.categoryModel.findOne({
            'marketplaceMappings.path': { $regex: new RegExp(`^${this.escapeRegex(categoryPath.trim())}$`, 'i') },
            active: true,
        });
        if (byPath) {
            this.logger.debug(`Category resolved by path: ${categoryPath} → ${byPath._id}`);
            return byPath._id as Types.ObjectId;
        }

        // Level 2: match by leaf node in name or synonyms
        const leaf = categoryPath.split('>').pop()?.trim() ?? '';
        if (leaf.length > 2) {
            const byLeaf = await this.categoryModel.findOne({
                $or: [
                    { name: { $regex: new RegExp(`^${this.escapeRegex(leaf)}$`, 'i') } },
                    { synonyms: { $regex: new RegExp(`^${this.escapeRegex(leaf)}$`, 'i') } },
                ],
                active: true,
            });
            if (byLeaf) {
                this.logger.debug(`Category resolved by leaf "${leaf}": ${byLeaf._id}`);
                return byLeaf._id as Types.ObjectId;
            }
        }

        // Level 3: partial token match, ordered by relevance desc
        const tokens = categoryPath
            .split('>')
            .map(t => t.trim())
            .filter(t => t.length > 3);

        if (tokens.length > 0) {
            const tokenFilters = tokens.map(t => ({
                name: { $regex: new RegExp(this.escapeRegex(t), 'i') },
            }));

            const candidates = await this.categoryModel
                .find({ $or: tokenFilters, active: true })
                .sort({ relevance: -1 })
                .limit(1)
                .lean()
                .exec();

            if (candidates.length > 0) {
                this.logger.debug(`Category resolved by token match: ${candidates[0]._id}`);
                return candidates[0]._id as Types.ObjectId;
            }
        }

        this.logger.debug(`No category match for: ${categoryPath}`);
        return null;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
