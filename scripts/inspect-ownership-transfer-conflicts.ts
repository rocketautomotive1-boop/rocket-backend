// backend/scripts/inspect-ownership-transfer-conflicts.ts
/**
 * Diagnóstico (somente leitura) dos 4 casos que transfer-store-listing-ownership.ts não conseguiu
 * migrar automaticamente (2026-08-30, segunda rodada): o mesmo externalId do ML aparece publicado
 * em DOIS marketplace_listing diferentes (um sob o StoreListing de origem errado, outro sob o de
 * destino correto) — StoreListingOwnershipService.executeMerge aborta de propósito nesse caso
 * (guard de conflito), porque decidir qual dos dois registros é o "vivo" exige contexto humano.
 *
 * Não escreve nada — só imprime o estado completo dos dois StoreListing (origem/destino) de cada
 * caso: marketplace_listings (status, createdAt/updatedAt), balances, lots, movements — para
 * decidir manualmente qual registro descartar antes de rodar a migração de novo.
 *
 * Uso:
 *   npx ts-node scripts/inspect-ownership-transfer-conflicts.ts
 */
import 'dotenv/config';
import { Types } from 'mongoose';

const CASES: Array<{ productId: string; fromStoreId: string; toStoreId: string; conflictExternalId: string }> = [
  { productId: '69a9ac39cfa05db7b812eaae', fromStoreId: '6a7cff4bf323afb241284d0d', toStoreId: '6a7cff4bf323afb241284d0c', conflictExternalId: 'MLB4508599735' },
  { productId: '6a3a72929707c76b7bc1b4db', fromStoreId: '6a7cff4bf323afb241284d0c', toStoreId: '6a7cff4bf323afb241284d0d', conflictExternalId: 'MLB4806355305' },
  { productId: '699c42520cf103938bf8a97c', fromStoreId: '6a7cff4bf323afb241284d0c', toStoreId: '6a7cff4bf323afb241284d0e', conflictExternalId: 'MLB6290117446' },
  { productId: '695688f61946eec2b3b6fc7b', fromStoreId: '6a7cff4bf323afb241284d0d', toStoreId: '6a7cff4bf323afb241284d0c', conflictExternalId: 'MLB5446484754' },
];

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingModel } = require('../src/store-listing/schemas/store-listing.schema');
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));
    const listingModel = app.get(getModelToken(ListingModel.name));

    for (const c of CASES) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Produto: ${c.productId}  |  origem(errada)=${c.fromStoreId}  destino(correta)=${c.toStoreId}  |  conflito=${c.conflictExternalId}`);

      const [source, destination] = await Promise.all([
        storeListingModel.findOne({ productId: new Types.ObjectId(c.productId), storeId: new Types.ObjectId(c.fromStoreId) }).lean().exec(),
        storeListingModel.findOne({ productId: new Types.ObjectId(c.productId), storeId: new Types.ObjectId(c.toStoreId) }).lean().exec(),
      ]);

      for (const [label, sl] of [['ORIGEM (errada)', source], ['DESTINO (correta)', destination]] as const) {
        if (!sl) {
          console.log(`  ${label}: StoreListing não encontrado.`);
          continue;
        }
        console.log(`  ${label} — StoreListing ${sl._id} (storeId=${sl.storeId})`);

        const [balances, mls] = await Promise.all([
          balanceModel.find({ storeListingId: sl._id }).lean().exec(),
          marketplaceListingModel.find({ storeListingId: sl._id }).lean().exec(),
        ]);

        console.log(`    balances: ${JSON.stringify(balances.map((b: any) => ({ condition: b.condition, onHand: b.onHand, reserved: b.reserved })))}`);
        for (const ml of mls) {
          const mark = ml.externalId === c.conflictExternalId ? '  <<< CONFLITO' : '';
          console.log(
            `    marketplace_listing ${ml._id} tag=${ml.marketplaceTag} externalId=${ml.externalId} status=${ml.status} createdAt=${ml.createdAt?.toISOString?.() ?? ml.createdAt} updatedAt=${ml.updatedAt?.toISOString?.() ?? ml.updatedAt}${mark}`,
          );
        }
      }

      const listingRows = await listingModel
        .find({ productId: new Types.ObjectId(c.productId), externalId: c.conflictExternalId })
        .select({ _id: 1, storeId: 1, status: 1, synchronized: 1, errorMessage: 1, lastSyncAt: 1 })
        .lean()
        .exec();
      console.log(`  ListingModel(s) com externalId=${c.conflictExternalId}: ${JSON.stringify(listingRows)}`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Inspect FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
