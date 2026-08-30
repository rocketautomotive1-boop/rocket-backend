// backend/scripts/check-product-full.ts
/**
 * Diagnóstico ad-hoc (somente leitura): dump completo de TODOS os StoreListing/marketplace_listing/
 * ListingModel de um produto, sem filtrar por par origem/destino — usado para investigar um caso
 * onde inspect-ownership-transfer-conflicts.ts pode ter mostrado um recorte incompleto (usuário
 * apontou anúncio ativo em "Rocket" para 69a9ac39cfa05db7b812eaae que não bateu com o que o
 * diagnóstico anterior mostrou).
 */
import 'dotenv/config';
import { Types } from 'mongoose';

const PRODUCT_ID = process.argv[2] ?? '69a9ac39cfa05db7b812eaae';

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingModel } = require('../src/store-listing/schemas/store-listing.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));
    const listingModel = app.get(getModelToken(ListingModel.name));

    const productId = new Types.ObjectId(PRODUCT_ID);

    const allStoreListings = await storeListingModel.find({ productId }).lean().exec();
    console.log(`Produto ${PRODUCT_ID} — ${allStoreListings.length} StoreListing(s):`);

    for (const sl of allStoreListings) {
      const mls = await marketplaceListingModel.find({ storeListingId: sl._id }).lean().exec();
      console.log(`\nStoreListing ${sl._id} (storeId=${sl.storeId}):`);
      for (const ml of mls) {
        console.log(
          `  ${ml._id} tag=${ml.marketplaceTag} externalId=${ml.externalId} status=${ml.status} updatedAt=${ml.updatedAt?.toISOString?.() ?? ml.updatedAt}`,
        );
      }
    }

    const allListings = await listingModel.find({ productId }).lean().exec();
    console.log(`\nTodos os ListingModel do produto (${allListings.length}):`);
    for (const l of allListings) {
      console.log(
        `  ${l._id} marketplaceId=${l.marketplaceId} storeId=${l.storeId} externalId=${l.externalId} status=${l.status} synchronized=${l.synchronized}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
