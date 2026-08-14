import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CategoryModel } from '../product/schemas/category.schema';

@Injectable()
export class CategoryDiscoveryService {
    private readonly logger = new Logger(CategoryDiscoveryService.name);

    constructor(
        @InjectModel(CategoryModel.name) private categoryModel: Model<CategoryModel>
    ) {}

    async syncBreadcrumbs(): Promise<{ updated: number }> {
        const categories = await this.categoryModel.find({}).lean().exec();
        const nameMap = new Map<string, string>(
            categories.map((c: any) => [c._id.toString(), c.name])
        );

        let updated = 0;
        for (const cat of categories) {
            const ancestorNames = ((cat as any).ancestors || [])
                .map((id: any) => nameMap.get(id.toString()))
                .filter(Boolean) as string[];
            const breadcrumbs = [...ancestorNames, (cat as any).name].join(' > ');
            await this.categoryModel.updateOne(
                { _id: (cat as any)._id },
                { $set: { breadcrumbs } }
            );
            updated++;
        }

        this.logger.log(`Synced breadcrumbs for ${updated} categories`);
        return { updated };
    }

    // No-op: kept for callers that still invalidate the search index on write.
    async indexCategory(_category: any) {}

    /** Busca por regex em memória (substitui o antigo $search do Atlas, cujo índice
     *  'categories_discovery' foi removido). Pontuação replica a ordem de boost anterior:
     *  frase exata em name > synonyms > name parcial > examples > breadcrumbs > usageGuide. */
    async discover(query: string): Promise<any[]> {
        try {
            const limitedQuery = query.trim().split(/\s+/).slice(0, 4).join(' ');
            if (!limitedQuery) return [];

            const escaped = limitedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'i');
            const exactPhrase = new RegExp(`\\b${escaped}\\b`, 'i');

            const categories = await this.categoryModel
                .find({
                    active: { $ne: false },
                    hidden: { $ne: true },
                    $or: [
                        { name: regex },
                        { synonyms: regex },
                        { examples: regex },
                        { breadcrumbs: regex },
                        { usageGuide: regex },
                    ],
                })
                .lean()
                .exec();

            const scored = categories.map((c: any) => {
                let score = 0;
                if (exactPhrase.test(c.name || '')) score += 10;
                else if (regex.test(c.name || '')) score += 5;
                if ((c.synonyms || []).some((s: string) => regex.test(s))) score += 8;
                if ((c.examples || []).some((e: string) => regex.test(e))) score += 3;
                if (regex.test(c.breadcrumbs || '')) score += 2;
                if (regex.test(c.usageGuide || '')) score += 1;
                return { c, score };
            });

            return scored
                .sort((a, b) => b.score - a.score)
                .slice(0, 10)
                .map(({ c, score }) => ({
                    id: c._id.toString(),
                    name: c.name,
                    breadcrumbs: c.breadcrumbs,
                    synonyms: c.synonyms,
                    examples: c.examples,
                    usage: c.usageGuide,
                    attributes: c.attributes,
                    productCount: c.productCount,
                    mappings: c.marketplaceMappings,
                    aiReason: c.aiReason,
                    score,
                }));
        } catch (error) {
            this.logger.error(`Error discovering category for "${query}": ${JSON.stringify({ ok: false, message: error.message })}`);
            return [];
        }
    }
}
