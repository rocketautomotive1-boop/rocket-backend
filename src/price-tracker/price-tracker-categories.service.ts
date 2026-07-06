import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TrackedCategoryModel } from './schemas/tracked-category.schema';
import { TrackedItemModel } from './schemas/tracked-item.schema';

export interface TrackedCategoryView {
  id: string;
  name: string;
}

/** CRUD de categorias livres. Excluir uma categoria NÃO apaga itens — só desatribui. */
@Injectable()
export class PriceTrackerCategoriesService {
  constructor(
    @InjectModel(TrackedCategoryModel.name) private readonly categoryModel: Model<TrackedCategoryModel>,
    @InjectModel(TrackedItemModel.name) private readonly itemModel: Model<TrackedItemModel>,
  ) {}

  async list(): Promise<TrackedCategoryView[]> {
    const docs = await this.categoryModel.find().sort({ name: 1 }).lean().exec();
    return docs.map((d: any) => ({ id: String(d._id), name: d.name }));
  }

  async create(name: string): Promise<TrackedCategoryView> {
    try {
      const doc = await this.categoryModel.create({ name });
      return { id: String(doc._id), name: doc.name };
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new BadRequestException(`Já existe uma categoria chamada "${name}"`);
      }
      throw e;
    }
  }

  async update(id: string, name: string): Promise<TrackedCategoryView> {
    const updated = await this.categoryModel
      .findByIdAndUpdate(id, { $set: { name } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Categoria não encontrada');
    return { id: String((updated as any)._id), name: (updated as any).name };
  }

  /** Remove a categoria e desatribui (categoryId: null) todos os itens dela. */
  async remove(id: string): Promise<void> {
    const removed = await this.categoryModel.findByIdAndDelete(id).lean().exec();
    if (!removed) throw new NotFoundException('Categoria não encontrada');
    await this.itemModel.updateMany({ categoryId: id }, { $set: { categoryId: null } }).exec();
  }
}
