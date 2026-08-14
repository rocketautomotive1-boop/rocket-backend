import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';

/**
 * Cache in-process (write-through) de categorias-chave resolvidas por slug — mesmo padrão de
 * MarketplaceConfigCacheService. Usado para achar o _id de nós estruturais da árvore (ex:
 * "acessorios") sem depender de string matching frágil em `name`; ver
 * docs/superpowers/specs/2026-07-13-product-relevance-rails-design.md.
 */
@Injectable()
export class CategoryLookupService {
  private readonly logger = new Logger(CategoryLookupService.name);
  private readonly bySlug = new Map<string, Types.ObjectId | null>();

  constructor(
    @InjectModel(CategoryModel.name)
    private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  /** Limpa o cache. Chamar sempre que uma categoria com slug relevante for criada/alterada. */
  invalidate(): void {
    this.bySlug.clear();
  }

  async resolveIdBySlug(slug: string): Promise<Types.ObjectId | null> {
    if (!slug) return null;
    if (this.bySlug.has(slug)) return this.bySlug.get(slug) ?? null;

    const category = await this.categoryModel.findOne({ slug }).select('_id').lean().exec();
    const id = category ? new Types.ObjectId(category._id as any) : null;
    this.bySlug.set(slug, id);
    if (!id) this.logger.warn(`Categoria com slug "${slug}" não encontrada`);
    return id;
  }
}
