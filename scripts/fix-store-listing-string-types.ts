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
  merged: number;
  invalid: number;
}

export async function fixStoreListingStringTypes(params: {
  candidates: Array<{ _id: Types.ObjectId; productId: any; storeId: any }>;
  findExisting: (productId: Types.ObjectId, storeId: Types.ObjectId) => Promise<Types.ObjectId | null>;
  updateOne: (id: Types.ObjectId, productId: Types.ObjectId, storeId: Types.ObjectId) => Promise<void>;
  mergeInto: (fromStoreListingId: Types.ObjectId, toStoreListingId: Types.ObjectId) => Promise<void>;
  dryRun: boolean;
}): Promise<StringTypeFixSummary> {
  const { candidates, findExisting, updateOne, mergeInto, dryRun } = params;
  const summary: StringTypeFixSummary = { totalCandidates: candidates.length, fixed: 0, merged: 0, invalid: 0 };

  for (const doc of candidates) {
    const productIdStr = String(doc.productId);
    const storeIdStr = String(doc.storeId);
    if (!Types.ObjectId.isValid(productIdStr) || !Types.ObjectId.isValid(storeIdStr)) {
      console.warn(`  [skip] storeListing ${String(doc._id)}: productId/storeId inválido (${productIdStr} / ${storeIdStr}).`);
      summary.invalid++;
      continue;
    }
    const productId = new Types.ObjectId(productIdStr);
    const storeId = new Types.ObjectId(storeIdStr);

    // Duplicata real: já existe um StoreListing com o mesmo (productId, storeId)
    // como ObjectId correto — converter este in-place violaria o índice único
    // {productId, storeId}. Merge: move lots/balances/movements/
    // marketplace_listings do documento string (que será removido pelo próprio
    // updateOne/mergeInto) para o já-correto, em vez de tentar coexistir.
    const conflictingId = await findExisting(productId, storeId);
    if (conflictingId) {
      if (!dryRun) await mergeInto(doc._id, conflictingId);
      summary.merged++;
      continue;
    }

    if (!dryRun) {
      await updateOne(doc._id, productId, storeId);
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
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { StoreListingStockMovementModel } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));
    const lotModel = app.get(getModelToken(StoreListingStockLotModel.name));
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name));
    const movementModel = app.get(getModelToken(StoreListingStockMovementModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));

    const candidates = await storeListingModel
      .find({ $or: [{ productId: { $type: 'string' } }, { storeId: { $type: 'string' } }] })
      .lean()
      .exec();

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Candidatos: ${candidates.length}`);

    const findExisting = async (productId: Types.ObjectId, storeId: Types.ObjectId) => {
      const existing = await storeListingModel.findOne({ productId, storeId }).lean().exec();
      return existing ? existing._id : null;
    };

    const updateOne = async (id: Types.ObjectId, productId: Types.ObjectId, storeId: Types.ObjectId) => {
      await storeListingModel.updateOne({ _id: id }, { $set: { productId, storeId } });
    };

    const mergeInto = async (fromId: Types.ObjectId, toId: Types.ObjectId) => {
      // fromId (string-typed) tem seus próprios filhos referenciando-o por
      // storeListingId — como o schema desses filhos já usa ObjectId
      // corretamente, o valor gravado neles é o ObjectId real do StoreListing
      // string (o _id do documento nunca teve o bug, só productId/storeId
      // internos). Move os filhos para o destino correto e remove o duplicado.
      await lotModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await balanceModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await movementModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await marketplaceListingModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await storeListingModel.deleteOne({ _id: fromId });
    };

    const summary = await fixStoreListingStringTypes({ candidates, findExisting, updateOne, mergeInto, dryRun });

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
