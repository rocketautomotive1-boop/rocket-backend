// backend/scripts/fix-store-listing-string-types.ts
/**
 * Corrige StoreListings com productId/storeId gravados como STRING em vez de
 * ObjectId — resíduo histórico (2.597 de 2.694 documentos em produção,
 * 2026-08-14). O schema sempre foi `MongooseSchema.Types.ObjectId` (correto);
 * o código atual de escrita (StoreListingService.create) já grava ObjectId
 * corretamente (confirmado via teste direto em produção) — este script não
 * corrige nenhum caminho de escrita, só migra dados legados que nunca tiveram
 * o cast aplicado (causa exata não identificada, mas não é reproduzível hoje).
 *
 * Consequência prática do bug: qualquer query com `ObjectId(productId)` no
 * filtro (ex: findByProductAndStore, resolução de readiness) nunca encontra
 * esses documentos — produtos aparecem como "sem StoreListing"/"sem estoque"
 * mesmo tendo saldo real migrado.
 *
 * Idempotente: só converte documentos onde productId ou storeId ainda são
 * string; rodar de novo não faz nada nos já corrigidos.
 *
 * Uso:
 *   npx ts-node scripts/fix-store-listing-string-types.ts             # dry-run
 *   npx ts-node scripts/fix-store-listing-string-types.ts --execute    # grava
 */
import 'dotenv/config';
import { Types } from 'mongoose';

export interface StringTypeFixSummary {
  totalCandidates: number;
  fixed: number;
  invalid: number;
}

export async function fixStoreListingStringTypes(params: {
  candidates: Array<{ _id: Types.ObjectId; productId: any; storeId: any }>;
  updateOne: (id: Types.ObjectId, productId: Types.ObjectId, storeId: Types.ObjectId) => Promise<void>;
  dryRun: boolean;
}): Promise<StringTypeFixSummary> {
  const { candidates, updateOne, dryRun } = params;
  const summary: StringTypeFixSummary = { totalCandidates: candidates.length, fixed: 0, invalid: 0 };

  for (const doc of candidates) {
    const productIdStr = String(doc.productId);
    const storeIdStr = String(doc.storeId);
    if (!Types.ObjectId.isValid(productIdStr) || !Types.ObjectId.isValid(storeIdStr)) {
      console.warn(`  [skip] storeListing ${String(doc._id)}: productId/storeId inválido (${productIdStr} / ${storeIdStr}).`);
      summary.invalid++;
      continue;
    }

    if (!dryRun) {
      await updateOne(doc._id, new Types.ObjectId(productIdStr), new Types.ObjectId(storeIdStr));
    }
    summary.fixed++;
  }

  return summary;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingModel } = require('../src/store-listing/schemas/store-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));

    const candidates = await storeListingModel
      .find({ $or: [{ productId: { $type: 'string' } }, { storeId: { $type: 'string' } }] })
      .lean()
      .exec();

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Candidatos: ${candidates.length}`);

    const updateOne = async (id: Types.ObjectId, productId: Types.ObjectId, storeId: Types.ObjectId) => {
      await storeListingModel.updateOne({ _id: id }, { $set: { productId, storeId } });
    };

    const summary = await fixStoreListingStringTypes({ candidates, updateOne, dryRun });

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, summary);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fix FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
