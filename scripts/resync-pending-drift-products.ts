// backend/scripts/resync-pending-drift-products.ts
/**
 * Dispara requestSync para produtos cujo listing RCK_AUTOMOTIVE/mercadolivre
 * foi limpo (fix-ml-account-drift.ts) mas ainda não foi republicado —
 * o gate de readiness estava bloqueado até as correções de
 * fix-store-listing-owner.ts (1497 mismatches) e
 * fix-store-listing-child-string-types.ts (15917 documentos), agora
 * resolvidas. Não mexe em nenhum dado — só re-solicita sync pelos produtos
 * já identificados como pending (sem externalId) na conta RCK_AUTOMOTIVE.
 *
 * Uso: npx ts-node scripts/resync-pending-drift-products.ts
 */
import 'dotenv/config';

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { OrchestratorPublisherService } = require('../src/marketplace-orchestrator/orchestrator-publisher.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const publisher = app.get(OrchestratorPublisherService);

    const ML_MARKETPLACE_ID = '6955b688dfe7143a30376b16';
    const RCK_AUTOMOTIVE_STORE_ID = '6a7cff4bf323afb241284d0e';

    const pending = await listingModel
      .find({
        marketplaceId: ML_MARKETPLACE_ID,
        storeId: RCK_AUTOMOTIVE_STORE_ID,
        externalId: { $exists: false },
      }, { productId: 1 })
      .lean()
      .exec();

    const productIds: string[] = [...new Set(pending.map((l: any) => String(l.productId)))];
    console.log(`Produtos pendentes de resync: ${productIds.length}`);

    for (const productId of productIds) {
      await publisher.requestSync({ productId, reason: 'resync_pending_drift' });
    }

    console.log(`\nResync solicitado para ${productIds.length} produto(s).`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Resync FAILED:', err?.message);
  console.error(err?.stack);
  process.exit(1);
});
