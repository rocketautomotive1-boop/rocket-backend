import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { BrandModel, BrandDocument } from '../schemas/brand.schema';
import { buildUniqueProductSlug } from '../utils/product-slug.util';
import { ImportCatalogItem, ImportCatalogResult } from '../dto/import-catalog.dto';
import { CrossReferenceService } from './cross-reference.service';
import { normalizeCode } from '../utils/code-key.util';

/**
 * `origemCatalogo` (tools/catalog-extractor catalog key) → part manufacturer brand name.
 * This is the BRAND OF THE PART (e.g. Cofap makes the shock absorber), not the vehicle
 * brand the part fits (e.g. Ford) — those are two different things conflated in the raw
 * catalog text as `marcaVeiculo`. The brand document must already exist in `brands`
 * (POST /brands) before importing; add an entry here per new SINGLE-brand catalog.
 *
 * Multi-brand catalogs (e.g. Schaeffler, which sells under LuK/INA/FAG/Ruville/
 * Schaeffler Vitesco) don't get an entry here — every item instead carries its
 * own `marcaProduto`, resolved by the extractor from the source catalog's
 * per-product manufacturer FK, which takes precedence over this default (see
 * the brandName resolution below).
 */
const CATALOG_BRAND_NAME: Record<string, string> = {
  cofap: 'Cofap',
  delphi: 'Delphi',
  magnetimarelli: 'Magneti Marelli',
  skf: 'SKF',
  valeo: 'Valeo',
  monroe: 'Monroe',
  perfect: 'Perfect',
  indisa: 'Indisa',
  ampri: 'Ampri',
  valclei: 'Valclei',
  grazzimetal: 'Grazzimetal',
  bastos: 'Bastos Juntas',
  tecfil: 'Tecfil',
  elring: 'Elring',
  taranto: 'Taranto',
  corteco: 'Corteco',
  iguacu: 'Iguaçu',
  albarus: 'Albarus',
  ima: 'IMA',
  spaal: 'Spaal Juntas',
  sampel: 'Sampel',
  kayaba: 'Kayaba',
  schadek: 'Schadek',
  mtethomson: 'MTE-Thomson',
  mg: 'MG Peças Automotivas',
  dayco: 'Dayco',
  denso: 'Denso',
  gauss: 'Gauss',
  continental: 'Continental',
  ngkntk: 'NGK/NTK',
  wega: 'Wega',
  transpo: 'Transpo',
  osram: 'Osram',
  hella: 'Hella',
  speedbrake: 'SpeedBrake',
  kitcia: 'Kit&Cia',
  dni: 'DNI',
  ate: 'ATE',
  dyna: 'Dyna',
  juntalima: 'Juntalima',
  mtf: 'MTF',
  jamaica: 'Jamaica',
  cauplas: 'Cauplas',
  dita: 'DITA',
  sintech: 'Sintech',
  riosulense: 'Riosulense',
  rainhadassete: 'Rainha das Sete', // fallback for the ~5200 products whose FABRICANTE is the house brand (marcaProduto null) — items with a real per-product manufacturer still override via marcaProduto
  fania: 'Fania',
  mrmk: 'Mr Mk',
  hiparts: 'Hi Parts',
  yiming: 'Yiming Parts',
  volda: 'Volda',
  arteb: 'Arteb',
  roltens: 'Roltens',
  villafranca: 'Villa Franca',
  illinois: 'Illinois',
  bfx: 'BFX',
  florio: 'Florio',
  syl: 'SYL',
  cemak: 'CEMAK',
  '3rho': '3-RHO',
};

/**
 * Bulk-upserts products scraped from a manufacturer's desktop catalog app
 * (see tools/catalog-extractor). Idempotent by design: `partNumber` (unique+sparse
 * index on ProductModel) is set to `codigoOrigem`, and every write is a Mongo
 * `bulkWrite` upsert keyed on it — re-importing the same export never duplicates
 * products, it only refreshes the denormalized catalog fields.
 *
 * Deliberately does NOT touch price, stock, active status, or images already
 * uploaded through the normal product flow — this only seeds/refreshes catalog
 * metadata (type, application rows, cross-reference codes). Image upload to S3
 * is a separate, explicit step (see importImages) because it's comparatively
 * slow and shouldn't block the metadata upsert.
 *
 * Cross-references carry manufacturer attribution ({brand, partNumber}) and are
 * NOT written straight to `oemCodes` — they go through CrossReferenceService,
 * which owns the canonical `cross_reference_groups` collection and keeps
 * `oemCodes` as its denormalized cache. Vehicle applications
 * (`aplicacoesCatalogo`) are stored as-is on `catalogApplications`; matching
 * them to real `vehicle_compatibilities` records is a separate step.
 */
@Injectable()
export class ImportCatalogService {
  private readonly logger = new Logger(ImportCatalogService.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(BrandModel.name) private readonly brandModel: Model<BrandDocument>,
    private readonly crossReferenceService: CrossReferenceService,
  ) {}

  async importItems(items: ImportCatalogItem[]): Promise<ImportCatalogResult> {
    const result: ImportCatalogResult = { total: items.length, created: 0, updated: 0, errors: [] };

    const existing = await this.productModel
      .find({ partNumber: { $in: items.map((i) => i.codigoOrigem) } })
      .select('partNumber')
      .lean();
    const existingPartNumbers = new Set(existing.map((p) => p.partNumber));

    // Resolve every brand name this batch needs — per-catalog default (CATALOG_BRAND_NAME)
    // plus any per-item override (marcaProduto, for multi-brand catalogs like Schaeffler's
    // LuK/INA/FAG/Ruville/Vitesco, resolved from the source's own FABRICANTE FK per product).
    const brandCache = new Map<string, { _id: string; name: string; shortName?: string; fullName?: string; isGenuine?: boolean } | null>();
    const wantedBrandNames = new Set<string>();
    for (const item of items) {
      const name = item.marcaProduto || CATALOG_BRAND_NAME[item.origemCatalogo];
      if (name) wantedBrandNames.add(name);
    }
    for (const brandName of wantedBrandNames) {
      const brand = await this.brandModel.findOne({ name: brandName }).lean();
      if (!brand) {
        this.logger.warn(`Marca "${brandName}" não encontrada em brands — crie via POST /brands antes de importar. Produtos seguirão sem brand.`);
      }
      brandCache.set(brandName, brand ? { _id: String(brand._id), name: brand.name, shortName: brand.shortName, fullName: brand.fullName, isGenuine: brand.isGenuine } : null);
    }

    const operations: any[] = [];

    for (const item of items) {
      try {
        const brandName = item.marcaProduto || CATALOG_BRAND_NAME[item.origemCatalogo];
        const partBrand = brandName ? brandCache.get(brandName) : null;
        const firstApplication = item.aplicacoesCatalogo[0];

        const setFields: Record<string, unknown> = {
          origemCatalogo: item.origemCatalogo,
          codigoOrigemCatalogo: item.codigoOrigem,
          catalogTipoProduto: item.tipoProduto || undefined,
          catalogPosicao: item.posicao || undefined,
          catalogMotorizacao: item.motorizacao || undefined,
          catalogObservacao: item.observacao || undefined,
          catalogLancamento: item.lancamento,
          catalogLancamentoData: item.lancamentoData || undefined,
          catalogLancamentoValidade: item.lancamentoValidade || undefined,
          catalogPromocao: item.promocao,
          catalogPromocaoData: item.promocaoData || undefined,
          catalogPromocaoValidade: item.promocaoValidade || undefined,
          catalogPontaEstoque: item.pontaEstoque,
          catalogCorIdentificacao: item.corIdentificacao || undefined,
          catalogPaisOrigem: item.paisOrigem || undefined,
          catalogEstadoMaterial: item.estadoMaterial || undefined,
        };
        if (item.imagensExtras.length > 0) {
          setFields.catalogImagensExtras = item.imagensExtras;
        }
        if (item.codigosSimilares.length > 0) {
          setFields.catalogSimilarCodes = item.codigosSimilares;
        }
        if (item.relacionadosAplicacao.length > 0) {
          setFields.catalogRelatedByApplication = item.relacionadosAplicacao;
        }
        if (item.componentesKit.length > 0) {
          setFields.catalogKitComponents = item.componentesKit;
        }
        if (item.atributosExtras.length > 0) {
          setFields.catalogAttributes = item.atributosExtras;
        }
        if (partBrand) {
          setFields.brand = partBrand;
        }
        if (item.gtin) {
          setFields.barcode = item.gtin;
        }
        if (item.pesoKg != null) {
          setFields.weight = item.pesoKg;
        }
        if (item.dimensoesMm) {
          setFields.dimensions = {
            length: item.dimensoesMm.comprimento,
            width: item.dimensoesMm.largura,
            height: item.dimensoesMm.altura,
          };
        }
        if (item.ncm) {
          setFields['tax.ncm'] = item.ncm;
        }
        if (item.aplicacoesCatalogo.length > 0) {
          setFields.catalogApplications = item.aplicacoesCatalogo;
          setFields.applicationSummary = item.aplicacoesCatalogo.map((a) =>
            [a.fabricante, a.modelo, a.complemento, a.periodo].filter(Boolean).join(' ').trim(),
          );
        }
        Object.keys(setFields).forEach((k) => setFields[k] === undefined && delete setFields[k]);

        const isNew = !existingPartNumbers.has(item.codigoOrigem);
        // bulkWrite bypasses the schema's pre-save hook, so partNumberKey (and
        // oemCodesKeys, if oemCodes were ever set here) must be computed explicitly.
        setFields.partNumberKey = normalizeCode(item.codigoOrigem);
        // active:true so imported products are searchable/visible on the
        // storefront right away — active only gates storefront listing/search
        // (see product-filter/rails/vehicle-search services), it doesn't
        // require stock or price and doesn't affect marketplace sync/readiness
        // (that's readyToPublish, computed separately and independently).
        const setOnInsert: Record<string, unknown> = { partNumber: item.codigoOrigem, active: true };

        if (isNew) {
          const nameParts = [item.tipoProduto, firstApplication?.fabricante, firstApplication?.modelo].filter(Boolean);
          setOnInsert.name = nameParts.length > 0 ? nameParts.join(' ') : item.codigoOrigem;
          setOnInsert.description = firstApplication
            ? [firstApplication.fabricante, firstApplication.modelo, firstApplication.complemento, firstApplication.periodo].filter(Boolean).join(' ')
            : '';
          setOnInsert.price = '0';
          setOnInsert.slug = await buildUniqueProductSlug(
            { partNumber: item.codigoOrigem, name: item.tipoProduto, brandShortName: partBrand?.shortName },
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
      // ordered:false lets independent operations in the batch succeed even
      // when one collides (e.g. two catalog codes that differ only by case
      // normalizing to the same partNumberKey under the same brand — see
      // docs/superpowers/... catalog-extractor onboarding notes). The driver
      // still throws a MongoBulkWriteError summarizing the batch once it's
      // done, even though most/all other ops committed — letting that
      // propagate turned one bad item into an HTTP 500 for the whole batch.
      try {
        const bulkResult = await this.productModel.bulkWrite(operations, { ordered: false });
        this.logger.log(
          `Import concluído: ${bulkResult.upsertedCount} criados, ${bulkResult.modifiedCount} atualizados, ${result.errors.length} erros`,
        );
      } catch (e) {
        const bulkError = e as { writeErrors?: { index: number; errmsg: string }[]; result?: { nUpserted: number; nModified: number } };
        if (!bulkError.writeErrors) throw e;
        for (const writeError of bulkError.writeErrors) {
          // operations[] and items[] share the same index only for items that
          // reached the push above (i.e. didn't hit the per-item catch at line
          // 184) — filter to just those to keep the mapping correct.
          const succeededItems = items.filter((i) => !result.errors.some((err) => err.codigoOrigem === i.codigoOrigem));
          const failedItem = succeededItems[writeError.index];
          if (!failedItem) continue;
          result.errors.push({ codigoOrigem: failedItem.codigoOrigem, message: writeError.errmsg });
          if (existingPartNumbers.has(failedItem.codigoOrigem)) result.updated--;
          else result.created--;
        }
        const upserted = bulkError.result?.nUpserted ?? 0;
        const modified = bulkError.result?.nModified ?? 0;
        this.logger.warn(
          `Import parcial: ${upserted} criados, ${modified} atualizados, ${bulkError.writeErrors.length} erros de escrita`,
        );
      }
    }

    // Cross-references need the product to already exist (processCrossReferences
    // looks it up by id), so this runs as a second pass after the bulk upsert.
    // Resolution is now safe under concurrency: processCrossReferences registers
    // each code via an atomic upsert against the (brand, codeKey) unique index on
    // cross_reference_codes, so items sharing a code (e.g. two products both
    // listing "Nakata:N99150") converge on the same group even when processed in
    // parallel — no client-side clustering/sequencing needed. The concurrency cap
    // below exists purely to bound load on Mongo, not for correctness.
    const CROSS_REF_CONCURRENCY = 10;
    const itemsWithRefs = items.filter((i) => i.referenciasCruzadas.length > 0 && !result.errors.some((e) => e.codigoOrigem === i.codigoOrigem));
    if (itemsWithRefs.length > 0) {
      const products = await this.productModel
        .find({ partNumber: { $in: itemsWithRefs.map((i) => i.codigoOrigem) } })
        .select('_id partNumber')
        .lean();
      const productIdByPartNumber = new Map(products.map((p) => [p.partNumber, String(p._id)]));

      const processOne = async (item: ImportCatalogItem) => {
        const productId = productIdByPartNumber.get(item.codigoOrigem);
        if (!productId) return;
        try {
          const references: { brand: string; partNumber: string }[] = item.referenciasCruzadas.map((r) => ({
            brand: r.brand,
            partNumber: r.partNumber,
          }));
          await this.crossReferenceService.processCrossReferences(productId, references);
        } catch (e) {
          result.errors.push({ codigoOrigem: item.codigoOrigem, message: `cross-reference: ${e.message}` });
        }
      };

      for (let i = 0; i < itemsWithRefs.length; i += CROSS_REF_CONCURRENCY) {
        const batch = itemsWithRefs.slice(i, i + CROSS_REF_CONCURRENCY);
        await Promise.all(batch.map(processOne));
      }
    }

    return result;
  }
}
