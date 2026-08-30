// backend/scripts/resolve-ownership-transfer-conflicts.ts
/**
 * Resolução pontual dos 4 casos que transfer-store-listing-ownership.ts não conseguiu migrar
 * (2026-08-30, segunda rodada) por conflito de externalId duplicado entre o StoreListing de origem
 * e o de destino. Investigado manualmente com inspect-ownership-transfer-conflicts.ts: nos 4 casos,
 * AMBOS os marketplace_listing conflitantes têm status 'error' (nenhum é um anúncio vivo no ML —
 * o ListingModel correspondente confirma errorMessage "Não indica os veículos compatíveis." e
 * synchronized:false nos 4) — são lixo histórico duplicado pelo mesmo bug de dual-write que criou
 * os 883 casos originais, não uma decisão automatizável em geral.
 *
 * Decisão explícita (não um guard genérico em StoreListingOwnershipService — mantido conservador
 * de propósito): apaga por _id só a cópia de ORIGEM de cada um dos 4 marketplace_listing
 * conflitantes confirmados abaixo. A cópia de destino nunca é tocada. Depois disso,
 * transfer-store-listing-ownership.ts (rerodado separadamente) resolve os 4 casos normalmente
 * (sem conflito remanescente).
 *
 * Uso:
 *   npx ts-node scripts/resolve-ownership-transfer-conflicts.ts              # dry-run
 *   npx ts-node scripts/resolve-ownership-transfer-conflicts.ts --execute     # apaga
 */
import 'dotenv/config';

// _id do marketplace_listing de ORIGEM a apagar em cada caso — confirmado manualmente via
// inspect-ownership-transfer-conflicts.ts (2026-08-30). productId/externalId só documentam a
// decisão; a operação em si usa somente o _id, para nunca apagar o documento errado por engano.
const CONFLICTS_TO_RESOLVE: Array<{
  productId: string;
  conflictExternalId: string;
  sourceMarketplaceListingId: string;
}> = [
  { productId: '69a9ac39cfa05db7b812eaae', conflictExternalId: 'MLB4508599735', sourceMarketplaceListingId: '6a8d8accff894dd0d2a1db16' },
  { productId: '6a3a72929707c76b7bc1b4db', conflictExternalId: 'MLB4806355305', sourceMarketplaceListingId: '6a7db6be7e7afc522ce23f78' },
  { productId: '699c42520cf103938bf8a97c', conflictExternalId: 'MLB6290117446', sourceMarketplaceListingId: '6a7db6a57e7afc522ce201fc' },
  { productId: '695688f61946eec2b3b6fc7b', conflictExternalId: 'MLB5446484754', sourceMarketplaceListingId: '6a7db6917e7afc522ce1cf58' },
];

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));

    for (const c of CONFLICTS_TO_RESOLVE) {
      const doc = await marketplaceListingModel.findById(c.sourceMarketplaceListingId).lean().exec();
      if (!doc) {
        console.log(`[skip] ${c.sourceMarketplaceListingId} (produto ${c.productId}) já não existe.`);
        continue;
      }
      if (doc.externalId !== c.conflictExternalId || doc.status !== 'error') {
        console.log(
          `[abort] ${c.sourceMarketplaceListingId} (produto ${c.productId}) não bate mais com o esperado (externalId=${doc.externalId}, status=${doc.status}) — não apagado, revisar manualmente.`,
        );
        continue;
      }

      console.log(
        `${dryRun ? '[DRY-RUN] ' : '[EXECUTE] '}apagando marketplace_listing ${c.sourceMarketplaceListingId} (produto ${c.productId}, externalId=${c.conflictExternalId}, status=error).`,
      );
      if (!dryRun) {
        await marketplaceListingModel.deleteOne({ _id: c.sourceMarketplaceListingId }).exec();
      }
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Resolve FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
