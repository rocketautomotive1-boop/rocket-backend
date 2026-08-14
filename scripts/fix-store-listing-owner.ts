// backend/scripts/fix-store-listing-owner.ts
/**
 * Corrige StoreListings com estoque real cuja loja diverge do storeId
 * (consistente) dos ListingModel do mesmo produto — resíduo de um backfill
 * anterior (backfill-store-listing-stock.ts) que resolvia a loja via
 * product.createdByUserId (sinal fraco, ausente em 99,99% do catálogo) em vez
 * do storeId já correto dos listings. Corrigido para novas execuções em
 * 2026-08-14 (ver resolveOwnerStoreByListing); este script corrige o que já
 * foi migrado errado antes desse fix, idempotência já garantida do backfill
 * não sendo re-executada nesse caso.
 *
 * Para cada StoreListing errado:
 *   - Se NÃO existe StoreListing na loja correta para o mesmo produto:
 *     re-key simples — atualiza storeId in-place (lots/balances/movements já
 *     referenciam por storeListingId, que não muda).
 *   - Se JÁ existe StoreListing na loja correta (conflito): MERGE — move
 *     lots/balances/movements do StoreListing errado para o correto, depois
 *     remove o StoreListing errado (agora vazio). Balances existentes no
 *     destino não são somados às do errado (evitaria duplicar saldo real);
 *     lots/balances/movements migrados carregam sua identidade própria
 *     (originalLotId/originalBalanceId/originalMovementId), então não há
 *     colisão ao simplesmente trocar o storeListingId de cada documento.
 *
 * NUNCA mexe em ListingModel (já corrigido por fix-listing-store-owner.ts)
 * nem em stock_lots/stock_balances/stock_movements legados (fonte, não
 * tocada por nenhum backfill).
 *
 * Uso:
 *   npx ts-node scripts/fix-store-listing-owner.ts              # dry-run
 *   npx ts-node scripts/fix-store-listing-owner.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Types } from 'mongoose';

export interface StoreListingMismatch {
  storeListingId: Types.ObjectId;
  productId: Types.ObjectId;
  currentStoreId: Types.ObjectId;
  correctStoreId: Types.ObjectId;
}

export interface FixSummary {
  totalMismatches: number;
  rekeyed: number;
  merged: number;
  errors: number;
}

export async function fixStoreListingOwner(params: {
  mismatches: StoreListingMismatch[];
  hasStoreListingAt: (productId: Types.ObjectId, storeId: Types.ObjectId) => Promise<Types.ObjectId | null>;
  rekey: (storeListingId: Types.ObjectId, newStoreId: Types.ObjectId) => Promise<void>;
  mergeInto: (fromStoreListingId: Types.ObjectId, toStoreListingId: Types.ObjectId) => Promise<void>;
  dryRun: boolean;
}): Promise<FixSummary> {
  const { mismatches, hasStoreListingAt, rekey, mergeInto, dryRun } = params;

  const summary: FixSummary = { totalMismatches: mismatches.length, rekeyed: 0, merged: 0, errors: 0 };

  for (const m of mismatches) {
    try {
      const conflictingId = await hasStoreListingAt(m.productId, m.correctStoreId);

      if (dryRun) {
        if (conflictingId) summary.merged++;
        else summary.rekeyed++;
        continue;
      }

      if (conflictingId) {
        await mergeInto(m.storeListingId, conflictingId);
        summary.merged++;
      } else {
        await rekey(m.storeListingId, m.correctStoreId);
        summary.rekeyed++;
      }
    } catch (err: any) {
      console.error(`  [erro] storeListing ${String(m.storeListingId)}: ${err?.message}`);
      summary.errors++;
    }
  }

  return summary;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { StoreListingModel } = require('../src/store-listing/schemas/store-listing.schema');
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { StoreListingStockMovementModel } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));
    const lotModel = app.get(getModelToken(StoreListingStockLotModel.name));
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name));
    const movementModel = app.get(getModelToken(StoreListingStockMovementModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));

    // 1. Levanta os mismatches: StoreListing com saldo real cuja loja diverge
    // do storeId consistente dos listings do mesmo produto.
    const allStoreListings = await storeListingModel.find().lean().exec();
    const mismatches: StoreListingMismatch[] = [];

    for (const sl of allStoreListings) {
      const listings = await listingModel
        .find({ productId: sl.productId, storeId: { $exists: true } }, { storeId: 1 })
        .lean()
        .exec();
      if (listings.length === 0) continue;

      const listingStoreIds: string[] = [...new Set<string>(listings.map((l: any) => String(l.storeId)))];
      if (listingStoreIds.length !== 1) continue; // ambíguo — fora de escopo, não decide por adivinhação

      const correctStoreId: string = listingStoreIds[0];
      if (correctStoreId === String(sl.storeId)) continue;

      const hasStock = await balanceModel.findOne({ storeListingId: sl._id, onHand: { $gt: 0 } }).lean().exec();
      if (!hasStock) continue;

      mismatches.push({
        storeListingId: sl._id,
        productId: sl.productId,
        currentStoreId: sl.storeId,
        correctStoreId: new Types.ObjectId(correctStoreId),
      });
    }

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Mismatches encontrados: ${mismatches.length}`);

    const hasStoreListingAt = async (productId: Types.ObjectId, storeId: Types.ObjectId) => {
      const existing = await storeListingModel.findOne({ productId, storeId }).lean().exec();
      return existing ? existing._id : null;
    };

    const rekey = async (storeListingId: Types.ObjectId, newStoreId: Types.ObjectId) => {
      await storeListingModel.updateOne({ _id: storeListingId }, { $set: { storeId: newStoreId } });
    };

    const mergeInto = async (fromId: Types.ObjectId, toId: Types.ObjectId) => {
      await lotModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await balanceModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await movementModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await marketplaceListingModel.updateMany({ storeListingId: fromId }, { $set: { storeListingId: toId } });
      await storeListingModel.deleteOne({ _id: fromId });
    };

    const summary = await fixStoreListingOwner({
      mismatches,
      hasStoreListingAt,
      rekey,
      mergeInto,
      dryRun,
    });

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
