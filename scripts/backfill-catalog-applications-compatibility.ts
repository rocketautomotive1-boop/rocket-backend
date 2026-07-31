/**
 * Backfill product_compatibilities a partir de catalogApplications (importado dos catálogos de
 * fabricante — ver ImportCatalogService). Casa cada linha {fabricante, modelo, periodo,
 * motorizacao} contra vehicle_compatibilities por make+model+ano(faixa)+motor; ver
 * docs/superpowers/specs/2026-07-24-catalog-applications-compatibility-backfill-design.md.
 *
 * Dry-run por padrão — só imprime o que seria criado. Use --apply para gravar.
 *
 * Run (dry-run, um produto): npx ts-node -r tsconfig-paths/register scripts/backfill-catalog-applications-compatibility.ts --productId=<id>
 * Run (grava, um produto):   npx ts-node -r tsconfig-paths/register scripts/backfill-catalog-applications-compatibility.ts --productId=<id> --apply
 * Run (dry-run, 1 catálogo): npx ts-node -r tsconfig-paths/register scripts/backfill-catalog-applications-compatibility.ts --origemCatalogo=valclei
 * Run (grava, 1 catálogo):   npx ts-node -r tsconfig-paths/register scripts/backfill-catalog-applications-compatibility.ts --origemCatalogo=valclei --apply
 * Run (todos, grava):        npx ts-node -r tsconfig-paths/register scripts/backfill-catalog-applications-compatibility.ts --apply
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { ProductModel, ProductCatalogApplication } from '../src/product/schemas/product.schema';
import { VehicleCompatibilityModel } from '../src/vehicle-compatibility/schemas/vehicle-compatibility.schema';
import { ProductCompatibilityModel } from '../src/product/schemas/product-compatibility.schema';
import { ProductCompatibilityService } from '../src/product/services/product-compatibility.service';
import { normalizeMake, normalizeModel } from '../src/vehicle-shared/utils/vehicle-normalizer.util';
import { parsePeriodoToYearRange, classifyCandidatesByEngine } from '../src/vehicle-shared/utils/catalog-application-match.util';

const BATCH_SIZE = 200;

interface ProductRunStats {
  linesRead: number;
  matched: number;
  needsReview: number;
  rejected: number;
  unmatched: number;
}

function parseArgs() {
  const apply = process.argv.includes('--apply');
  const productIdArg = process.argv.find((a) => a.startsWith('--productId='));
  const productId = productIdArg ? productIdArg.split('=')[1] : undefined;
  const origemCatalogoArg = process.argv.find((a) => a.startsWith('--origemCatalogo='));
  const origemCatalogo = origemCatalogoArg ? origemCatalogoArg.split('=')[1] : undefined;
  return { apply, productId, origemCatalogo };
}

async function findVehicleCandidates(
  vehicleModel: Model<VehicleCompatibilityModel>,
  application: ProductCatalogApplication,
): Promise<Array<{ vehicleId: string; displacementCc?: number; fuelType?: string }>> {
  const makeKey = normalizeMake(application.fabricante);
  const modelKey = normalizeModel(application.modelo);
  if (!makeKey || !modelKey) return [];

  const query: Record<string, unknown> = { makeKey, modelKey, active: true };

  const yearRange = parsePeriodoToYearRange(application.periodo);
  if (yearRange) {
    query.years = { $elemMatch: { $gte: yearRange.from, $lte: yearRange.to } };
  }

  const docs = await vehicleModel
    .find(query as any)
    .select('_id displacementCc fuelType')
    .lean()
    .exec();

  return (docs as any[]).map((d) => ({
    vehicleId: String(d._id),
    displacementCc: d.displacementCc,
    fuelType: d.fuelType,
  }));
}

async function processProduct(
  product: { _id: Types.ObjectId; catalogApplications?: ProductCatalogApplication[] },
  vehicleModel: Model<VehicleCompatibilityModel>,
  compatibilityModel: Model<ProductCompatibilityModel>,
  compatibilityService: ProductCompatibilityService,
  apply: boolean,
  logger: Logger,
): Promise<ProductRunStats> {
  const stats: ProductRunStats = { linesRead: 0, matched: 0, needsReview: 0, rejected: 0, unmatched: 0 };
  const productId = String(product._id);

  const existing = await compatibilityModel.find({ product: product._id } as any).select('vehicleId').lean().exec();
  const existingVehicleIds = new Set((existing as any[]).map((e) => e.vehicleId));

  // Sets por produto (não por linha): o mesmo vehicleId frequentemente bate em mais de uma
  // linha de catalogApplications do mesmo produto (faixas de ano sobrepostas, ou linhas quase
  // duplicadas do catálogo de origem) — contar por linha infla o relatório em relação ao que
  // de fato é gravado (uma linha por par produto/veículo). matched/needsReview/rejected nos
  // stats refletem contagem ÚNICA de veículos, não ocorrências por linha.
  const matchedVehicleIds = new Set<string>();
  const needsReviewVehicleIds = new Set<string>();
  const rejectedVehicleIds = new Set<string>();

  for (const application of product.catalogApplications ?? []) {
    stats.linesRead++;
    const candidates = await findVehicleCandidates(vehicleModel, application);

    if (candidates.length === 0) {
      stats.unmatched++;
      logger.debug(
        `produto=${productId} sem candidato: ${application.fabricante} ${application.modelo} ${application.periodo ?? ''}`,
      );
      continue;
    }

    // rejected: motor explicitamente diferente (mesma marca/modelo/ano, mas cilindrada ou
    // combustível divergem com dado presente nos dois lados) — descartado, não criamos
    // compatibilidade nenhuma pra esse candidato. Não é ambíguo, não precisa de revisão manual.
    const { matched, needsReview, rejected } = classifyCandidatesByEngine(application.motorizacao, candidates);

    for (const vehicleId of matched) matchedVehicleIds.add(vehicleId);
    for (const vehicleId of needsReview) needsReviewVehicleIds.add(vehicleId);
    for (const vehicleId of rejected) rejectedVehicleIds.add(vehicleId);
  }

  // Um veículo pode aparecer como matched numa linha e rejected/needsReview em outra do mesmo
  // produto (motores diferentes citados em linhas diferentes) — matched vence, é o sinal mais
  // forte de compatibilidade real.
  for (const id of matchedVehicleIds) {
    needsReviewVehicleIds.delete(id);
    rejectedVehicleIds.delete(id);
  }
  for (const id of needsReviewVehicleIds) rejectedVehicleIds.delete(id);

  stats.matched = [...matchedVehicleIds].filter((id) => !existingVehicleIds.has(id)).length;
  stats.needsReview = [...needsReviewVehicleIds].filter((id) => !existingVehicleIds.has(id)).length;
  stats.rejected = rejectedVehicleIds.size;

  const allNewVehicleIds = [
    ...[...matchedVehicleIds].filter((id) => !existingVehicleIds.has(id)),
    ...[...needsReviewVehicleIds].filter((id) => !existingVehicleIds.has(id)),
  ];
  logger.log(
    `produto=${productId} linhas=${stats.linesRead} matched=${stats.matched} needsReview=${stats.needsReview} rejected=${stats.rejected} unmatched=${stats.unmatched}`,
  );

  if (!apply || allNewVehicleIds.length === 0) return stats;

  await compatibilityService.createMultipleCompatibilitiesBatch({
    productId,
    vehicleIds: allNewVehicleIds,
  });

  const needsReviewIds = [...needsReviewVehicleIds].filter((id) => !existingVehicleIds.has(id));
  if (needsReviewIds.length > 0) {
    await compatibilityModel
      .updateMany({ product: product._id, vehicleId: { $in: needsReviewIds } } as any, { $set: { needsReview: true } })
      .exec();
  }

  return stats;
}

async function bootstrap() {
  const logger = new Logger('BackfillCatalogApplicationsCompatibility');
  const { apply, productId, origemCatalogo } = parseArgs();

  if (!apply) logger.log('DRY-RUN — nada será gravado. Use --apply para gravar.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));
    const vehicleModel = app.get<Model<VehicleCompatibilityModel>>(getModelToken(VehicleCompatibilityModel.name));
    const compatibilityModel = app.get<Model<ProductCompatibilityModel>>(getModelToken(ProductCompatibilityModel.name));
    const compatibilityService = app.get(ProductCompatibilityService);

    const totals: ProductRunStats & { products: number } = {
      products: 0,
      linesRead: 0,
      matched: 0,
      needsReview: 0,
      rejected: 0,
      unmatched: 0,
    };

    const baseFilter: Record<string, unknown> = { catalogApplications: { $exists: true, $ne: [] } };
    if (productId) baseFilter._id = new Types.ObjectId(productId);
    if (origemCatalogo) baseFilter.origemCatalogo = origemCatalogo;

    let skip = 0;
    while (true) {
      const products = await productModel
        .find(baseFilter as any)
        .select('_id catalogApplications')
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      if (products.length === 0) break;

      for (const product of products as any[]) {
        const stats = await processProduct(product, vehicleModel, compatibilityModel, compatibilityService, apply, logger);
        totals.products++;
        totals.linesRead += stats.linesRead;
        totals.matched += stats.matched;
        totals.needsReview += stats.needsReview;
        totals.rejected += stats.rejected;
        totals.unmatched += stats.unmatched;
      }

      skip += BATCH_SIZE;
      if (productId) break;
    }

    logger.log(
      `TOTAL produtos=${totals.products} linhas=${totals.linesRead} matched=${totals.matched} needsReview=${totals.needsReview} rejected=${totals.rejected} unmatched=${totals.unmatched}`,
    );
  } finally {
    await app.close();
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-catalog-applications-compatibility] failed:', err?.message || err);
    process.exit(1);
  });
