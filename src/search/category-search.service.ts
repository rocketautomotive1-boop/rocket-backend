import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CategoryModel } from '../product/schemas/category.schema';
import { toLowerClean } from '../vehicle-shared/utils/string.util';

@Injectable()
export class CategorySearchService {
    private readonly logger = new Logger(CategorySearchService.name);

    // Cache in-process da árvore montada. Categorias mudam raríssimo mas a
    // árvore é lida a cada carregamento do CategoryBarV2 (storefront inteiro).
    // Invalidado por indexCategory/removeCategory, que já são o ponto único
    // por onde toda escrita de categoria passa (ver ProductCategoryService).
    private treeCache: any[] | null = null;

    constructor(
        @InjectModel(CategoryModel.name) private categoryModel: Model<CategoryModel>
    ) {}

    async getTree() {
        if (this.treeCache) return this.treeCache;

        try {
            const categories = await this.categoryModel
                .find({ active: true })
                .select('_id name slug parentId ancestors active hidden image icon relevance productCount synonyms examples breadcrumbs')
                .lean()
                .exec();
            const visible = this.excludeHiddenSubtrees(categories);
            this.treeCache = this.pruneEmpty(this.buildTree(visible));
            return this.treeCache;
        } catch (error) {
            this.logger.error(`Error fetching category tree: ${error.message}`);
            return [];
        }
    }

    /** Chamado por qualquer fluxo que escreva em CategoryModel fora de indexCategory/removeCategory
     *  (ex: bulkWrite de productCount em ProductCategoryService.updateProductCounts). */
    invalidateTreeCache(): void {
        this.treeCache = null;
    }

    /** Remove uma categoria marcada hidden:true e toda a sua subárvore (descendentes via
     *  ancestors), não só o nó em si — ex: "Alimentos e Bebidas" hidden esconde também
     *  "Alimentos e Bebidas > Snacks", mesmo que "Snacks" não esteja marcado. */
    private excludeHiddenSubtrees(categories: any[]): any[] {
        const hiddenIds = new Set(
            categories.filter(c => c.hidden).map(c => c._id.toString())
        );
        return categories.filter(c => {
            if (hiddenIds.has(c._id.toString())) return false;
            return !(c.ancestors || []).some((a: any) => hiddenIds.has(a.toString()));
        });
    }

    private buildTree(categories: any[]) {
        const map = new Map<string, any>();
        const roots: any[] = [];

        categories.forEach(cat => {
            map.set(cat._id.toString(), { ...cat, children: [] });
        });

        categories.forEach(cat => {
            const parentId = cat.parentId?.toString();
            if (parentId && map.has(parentId)) {
                map.get(parentId).children.push(map.get(cat._id.toString()));
            } else {
                roots.push(map.get(cat._id.toString()));
            }
        });

        return roots;
    }

    /** Remove nós (e subárvores) sem nenhum produto, próprio ou em descendentes.
     *  productCount é por categoria individual (não acumulado), então uma categoria-pai
     *  sem produto direto continua visível se algum filho tiver produto. */
    private pruneEmpty(nodes: any[]): any[] {
        const kept: any[] = [];
        for (const node of nodes) {
            node.children = this.pruneEmpty(node.children);
            const totalProductCount = (node.productCount || 0) +
                node.children.reduce((sum: number, child: any) => sum + child.totalProductCount, 0);
            node.totalProductCount = totalProductCount;
            if (totalProductCount > 0) kept.push(node);
        }
        return kept;
    }

    // Called by ProductCategoryService after create/update operations.
    // Takes the opportunity to persist the pre-computed breadcrumbs field so Atlas Search can index it.
    async indexCategory(category: any, breadcrumbsText?: string) {
        try {
            const breadcrumbs = breadcrumbsText ?? await this.computeBreadcrumbs(category);
            await this.categoryModel.updateOne(
                { _id: category._id },
                { $set: { breadcrumbs } }
            );
        } catch (error) {
            this.logger.error(`Error updating breadcrumbs for category ${category._id}: ${error.message}`);
        } finally {
            this.invalidateTreeCache();
        }
    }

    // No-op: Atlas Search auto-removes documents deleted from MongoDB.
    async removeCategory(_id: string) {
        this.invalidateTreeCache();
    }

    private async computeBreadcrumbs(category: any): Promise<string> {
        if (!category.ancestors || category.ancestors.length === 0) {
            return category.name || '';
        }
        const ancestors = await this.categoryModel
            .find({ _id: { $in: category.ancestors } }, { name: 1 })
            .lean()
            .exec();
        const nameMap = new Map((ancestors as any[]).map(a => [a._id.toString(), a.name]));
        const names = (category.ancestors as any[])
            .map((id: any) => nameMap.get(id.toString()))
            .filter(Boolean) as string[];
        return [...names, category.name].join(' > ');
    }

    /** Busca sobre a árvore já podada (getTree), não uma query Mongo separada — garante que
     *  a busca respeita a mesma regra de visibilidade da árvore (só categorias com produto,
     *  próprio ou via descendente), sem duplicar a lógica de rollup em dois lugares.
     *  Cada palavra do termo é normalizada (sem acento/caixa) e precisa aparecer em algum
     *  campo (AND entre palavras, OR entre campos) — "forro porta" bate com "Forro de Porta"
     *  mesmo sem acentuação, em vez de exigir a frase literal como substring. */
    async searchCategories(query: string) {
        try {
            const words = toLowerClean(query).split(/\s+/).filter(Boolean);
            if (words.length === 0) return [];

            const tree = await this.getTree();
            const matches = this.flattenTree(tree).filter((c: any) => {
                const haystack = [c.name, ...(c.synonyms || []), ...(c.examples || [])]
                    .map((s: string) => toLowerClean(s))
                    .join(' | ');
                return words.every((w) => haystack.includes(w));
            });
            matches.sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0));
            return matches.slice(0, 20).map((c: any) => ({
                id: c._id.toString(),
                _id: c._id,
                name: c.name,
                slug: c.slug,
                breadcrumbs: c.breadcrumbs,
                relevance: c.relevance,
            }));
        } catch (error) {
            this.logger.error(`Error searching categories: ${error.message}`);
            return [];
        }
    }

    private flattenTree(nodes: any[]): any[] {
        const result: any[] = [];
        for (const node of nodes) {
            result.push(node);
            if (node.children?.length) result.push(...this.flattenTree(node.children));
        }
        return result;
    }
}
