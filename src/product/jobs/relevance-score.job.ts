import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';

/**
 * Recalcula e persiste ProductModel.relevanceScore de todos os produtos ativos, usado para
 * ordenar os rails da home (universal/best-sellers/for-your-car/accessories-for-your-car).
 * Ver docs/superpowers/specs/2026-07-13-product-relevance-rails-design.md.
 *
 * dataScore = normalize(totalSold)*0.7 + normalize(ratingAverage*log(1+ratingCount))*0.3
 * relevanceScore = dataScore * category.priorityWeight
 *
 * Sem vendas/avaliação, dataScore tende a 0 e o score fica dominado pelo priorityWeight
 * (cold start); conforme o histórico cresce, dataScore passa a dominar naturalmente.
 */
@Injectable()
export class RelevanceScoreJob {
  private readonly logger = new Logger(RelevanceScoreJob.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(CategoryModel.name) private readonly categoryModel: Model<CategoryDocument>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async recalculate(): Promise<void> {
    const startedAt = Date.now();

    const [products, categories] = await Promise.all([
      this.productModel
        .find({ active: true })
        .select('_id totalSold ratingAverage ratingCount category')
        .lean()
        .exec(),
      this.categoryModel.find().select('_id priorityWeight').lean().exec(),
    ]);

    if (products.length === 0) return;

    const weightByCategory = new Map<string, number>(
      categories.map((c: any) => [String(c._id), c.priorityWeight ?? 1]),
    );

    const totalSoldValues = products.map((p: any) => p.totalSold ?? 0);
    const engagementValues = products.map((p: any) =>
      (p.ratingAverage ?? 0) * Math.log(1 + (p.ratingCount ?? 0)),
    );
    const normalizeTotalSold = this.buildNormalizer(totalSoldValues);
    const normalizeEngagement = this.buildNormalizer(engagementValues);

    const ops = products.map((p: any) => {
      const dataScore =
        normalizeTotalSold(p.totalSold ?? 0) * 0.7 +
        normalizeEngagement((p.ratingAverage ?? 0) * Math.log(1 + (p.ratingCount ?? 0))) * 0.3;
      const priorityWeight = weightByCategory.get(String(p.category)) ?? 1;
      const relevanceScore = dataScore * priorityWeight;

      return {
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { relevanceScore } },
        },
      };
    });

    await this.productModel.bulkWrite(ops);
    this.logger.log(
      `RelevanceScoreJob: ${products.length} produto(s) recalculado(s) em ${Date.now() - startedAt}ms`,
    );
  }

  /** Min-max normalize para [0,1]; se não há variação no batch, tudo mapeia para 0. */
  private buildNormalizer(values: number[]): (value: number) => number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) return () => 0;
    return (value: number) => (value - min) / range;
  }
}
