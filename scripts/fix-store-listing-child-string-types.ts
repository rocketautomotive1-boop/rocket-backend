// backend/scripts/fix-store-listing-child-string-types.ts
/**
 * Corrige `storeListingId` gravado como STRING (em vez de ObjectId) nas
 * coleções filhas do StoreListing aggregate — mesmo bug sistêmico já
 * corrigido em `store_listings.productId/storeId`
 * (fix-store-listing-string-types.ts), agora confirmado também em:
 *   - store_listing_stock_lots (2497/2627 documentos, 2026-08-14)
 *   - store_listing_stock_balances (2177/2307)
 *   - store_listing_stock_movements (2753/2898)
 *   - marketplace_listings (10490/10546)
 *
 * Consequência prática: queries por `storeListingId` (ObjectId) nunca
 * encontravam esses documentos — StoreListings corrigidos por
 * fix-store-listing-owner.ts (rekey) apareciam com saldo/lots/anúncios
 * "vazios" mesmo tendo dados reais, porque os filhos continuavam
 * referenciando o `_id` certo mas gravado como string.
 *
 * Não há índice único composto envolvendo storeListingId nessas coleções
 * (diferente de store_listings.{productId,storeId}) — não há caso de
 * conflito/merge aqui, é uma conversão direta e segura.
 *
 * Idempotente: só converte documentos onde storeListingId ainda é string.
 *
 * Uso:
 *   npx ts-node scripts/fix-store-listing-child-string-types.ts             # dry-run
 *   npx ts-node scripts/fix-store-listing-child-string-types.ts --execute    # grava
 */
import 'dotenv/config';
import { Types } from 'mongoose';

export interface ChildStringTypeFixSummary {
  totalCandidates: number;
  fixed: number;
  invalid: number;
}

export async function fixStoreListingChildStringTypes(params: {
  candidates: Array<{ _id: Types.ObjectId; storeListingId: any }>;
  updateOne: (id: Types.ObjectId, storeListingId: Types.ObjectId) => Promise<void>;
  dryRun: boolean;
}): Promise<ChildStringTypeFixSummary> {
  const { candidates, updateOne, dryRun } = params;
  const summary: ChildStringTypeFixSummary = { totalCandidates: candidates.length, fixed: 0, invalid: 0 };

  for (const doc of candidates) {
    const storeListingIdStr = String(doc.storeListingId);
    if (!Types.ObjectId.isValid(storeListingIdStr)) {
      console.warn(`  [skip] doc ${String(doc._id)}: storeListingId inválido (${storeListingIdStr}).`);
      summary.invalid++;
      continue;
    }

    if (!dryRun) {
      await updateOne(doc._id, new Types.ObjectId(storeListingIdStr));
    }
    summary.fixed++;
  }

  return summary;
}

async function fixCollection(model: any, label: string, dryRun: boolean): Promise<ChildStringTypeFixSummary> {
  const candidates = await model.find({ storeListingId: { $type: 'string' } }).lean().exec();
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}${label}: ${candidates.length} candidatos.`);

  const updateOne = async (id: Types.ObjectId, storeListingId: Types.ObjectId) => {
    await model.updateOne({ _id: id }, { $set: { storeListingId } });
  };

  const summary = await fixStoreListingChildStringTypes({ candidates, updateOne, dryRun });
  console.log(`  ${label}:`, summary);
  return summary;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { StoreListingStockMovementModel } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const lotModel = app.get(getModelToken(StoreListingStockLotModel.name));
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name));
    const movementModel = app.get(getModelToken(StoreListingStockMovementModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));

    await fixCollection(lotModel, 'store_listing_stock_lots', dryRun);
    await fixCollection(balanceModel, 'store_listing_stock_balances', dryRun);
    await fixCollection(movementModel, 'store_listing_stock_movements', dryRun);
    await fixCollection(marketplaceListingModel, 'marketplace_listings', dryRun);
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
