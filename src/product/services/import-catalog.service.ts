import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { buildUniqueProductSlug } from '../utils/product-slug.util';
import { ImportCatalogItem, ImportCatalogResult } from '../dto/import-catalog.dto';

/**
 * Bulk-upserts products scraped from a manufacturer's desktop catalog app
 * (see tools/catalog-extractor). Idempotent by design: `partNumber` (unique+sparse
 * index on ProductModel) is set to `codigoOrigem`, and every write is a Mongo
 * `bulkWrite` upsert keyed on it — re-importing the same export never duplicates
 * products, it only refreshes the denormalized catalog fields.
 *
 * Deliberately does NOT touch price, stock, active status, or images already
 * uploaded through the normal product flow — this only seeds/refreshes catalog
 * metadata (type, vehicle brand, application, cross-reference codes). Image
 * upload to S3 is a separate, explicit step (see importImages) because it's
 * comparatively slow and shouldn't block the metadata upsert.
 */
@Injectable()
export class ImportCatalogService {
  private readonly logger = new Logger(ImportCatalogService.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
  ) {}

  async importItems(items: ImportCatalogItem[]): Promise<ImportCatalogResult> {
    const result: ImportCatalogResult = { total: items.length, created: 0, updated: 0, errors: [] };

    const existing = await this.productModel
      .find({ partNumber: { $in: items.map((i) => i.codigoOrigem) } })
      .select('partNumber')
      .lean();
    const existingPartNumbers = new Set(existing.map((p) => p.partNumber));

    const operations: any[] = [];

    for (const item of items) {
      try {
        const applicationSummary = [item.marcaVeiculo, item.aplicacao].filter(Boolean).join(' ').trim();

        const setFields: Record<string, unknown> = {
          origemCatalogo: item.origemCatalogo,
          codigoOrigemCatalogo: item.codigoOrigem,
          catalogTipoProduto: item.tipoProduto || undefined,
          catalogPosicao: item.posicao || undefined,
          catalogMotorizacao: item.motorizacao || undefined,
        };
        if (item.referenciasCruzadas.length > 0) {
          setFields.oemCodes = item.referenciasCruzadas;
        }
        if (applicationSummary) {
          setFields.applicationSummary = [applicationSummary];
        }
        Object.keys(setFields).forEach((k) => setFields[k] === undefined && delete setFields[k]);

        const isNew = !existingPartNumbers.has(item.codigoOrigem);
        const setOnInsert: Record<string, unknown> = { partNumber: item.codigoOrigem, active: false };

        if (isNew) {
          setOnInsert.name = item.tipoProduto
            ? `${item.tipoProduto} ${item.codigoOrigem}`.trim()
            : item.codigoOrigem;
          setOnInsert.description = item.aplicacao || '';
          setOnInsert.price = '0';
          setOnInsert.slug = await buildUniqueProductSlug(
            { partNumber: item.codigoOrigem, name: item.tipoProduto },
            async (candidate) => !!(await this.productModel.exists({ slug: candidate })),
          );
        }

        operations.push({
          updateOne: {
            filter: { partNumber: item.codigoOrigem },
            update: { $set: setFields, $setOnInsert: setOnInsert },
            upsert: true,
          },
        });

        if (isNew) result.created++;
        else result.updated++;
      } catch (e) {
        result.errors.push({ codigoOrigem: item.codigoOrigem, message: e.message });
      }
    }

    if (operations.length > 0) {
      const bulkResult = await this.productModel.bulkWrite(operations, { ordered: false });
      this.logger.log(
        `Import concluído: ${bulkResult.upsertedCount} criados, ${bulkResult.modifiedCount} atualizados, ${result.errors.length} erros`,
      );
    }

    return result;
  }
}
