// backend/scripts/backfill-missing-marketplace-listings.ts
/**
 * Fecha o gap deixado pela 1ª execução de backfill-store-listings.ts: naquela
 * rodada, listings de marketplaces sem conta configurada em stores.
 * marketplaceAccounts (shopee/amazon/magalu/olx/rocket/yampi) ficaram com
 * `storeId` gravado (não são reprocessados por backfill-store-listings.ts,
 * cujo filtro é `storeId: {$exists:false}`), mas sem MarketplaceListing
 * correspondente. Depois de vincular as contas reais em `stores`, este
 * script varre listings COM storeId e SEM MarketplaceListing, e cria o que
 * falta — reusa `backfillStoreListings` (mesma lógica de resolução de tag/
 * conta/status, mesma idempotência via BadRequestException), só que com
 * `resolveStore` retornando direto o storeId já gravado no listing (não
 * precisa re-resolver via createdByUserId/fallback).
 *
 * Uso:
 *   npx ts-node scripts/backfill-missing-marketplace-listings.ts             # dry-run
 *   npx ts-node scripts/backfill-missing-marketplace-listings.ts --execute    # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Model, Types } from 'mongoose';
import { backfillStoreListings, ListingRow } from './backfill-store-listings';
import type { StoreListingService } from '../src/store-listing/store-listing.service';
import type { StorePort } from '../src/store/ports/store.port';
import type { ListingDocument } from '../src/listing/schemas/listing.schema';

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingService } = require('../src/store-listing/store-listing.service');
  const { MarketplaceConfigCacheService } = require('../src/marketplace/services/marketplace-config-cache.service');
  const { STORE_PORT } = require('../src/store/ports/store.port');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const storeListingService = app.get(StoreListingService) as StoreListingService;
    const configCache = app.get(MarketplaceConfigCacheService);
    const storePort = app.get(STORE_PORT) as StorePort;
    const listingModel = app.get(getModelToken(ListingModel.name)) as Model<ListingDocument>;
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name)) as Model<any>;

    const resolveMarketplaceTag = async (marketplaceId: string): Promise<string> => {
      const config = await configCache.getById(marketplaceId);
      if (!config) throw new Error(`Marketplace ${marketplaceId} não encontrado no cache de config.`);
      return config.tag;
    };

    const resolveAccountId = async (storeId: string, marketplaceTag: string): Promise<string | null> =>
      storePort.resolveAccountId(storeId, marketplaceTag);

    const BATCH_SIZE = 500;
    let processed = 0;
    let skip = 0;
    const aggregateSummary = {
      totalListings: 0,
      resolvedViaOwner: 0,
      resolvedViaFallback: 0,
      storeListingsCreated: 0,
      storeListingsReused: 0,
      marketplaceListingsCreated: 0,
      marketplaceListingsReused: 0,
      skippedNoAccount: 0,
    };

    for (;;) {
      // Filtro: listings com storeId já gravado (fase anterior já resolveu o
      // dono). Buscamos um lote e, dentro dele, filtramos os que ainda não
      // têm MarketplaceListing para o par (storeListingId, marketplaceTag)
      // correspondente — feito em memória pois StoreListing precisa ser
      // resolvido por (productId, storeId) para cada linha primeiro.
      //
      // Diferente de backfill-store-listings.ts: aqui o filtro
      // {storeId:{$exists:true}} NUNCA encolhe com as escritas deste script
      // (ele só cria MarketplaceListing, nunca mexe em ListingModel.storeId)
      // — skip sempre avança normalmente, em dry-run OU execute.
      const batch = await listingModel
        .find({ storeId: { $exists: true } })
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();
      if (batch.length === 0) break;

      // Mapa productId+storeId (string) -> storeId, usado por resolveStore abaixo
      // já que cada row deste script já TEM storeId gravado — não precisa
      // re-resolver via createdByUserId/fallback como no backfill original.
      const storeIdByListingId = new Map<string, string>();

      const rowsNeedingMarketplaceListing: ListingRow[] = [];
      for (const l of batch as any[]) {
        // Usa storeListingService.findByProductAndStore (não o Model direto) de propósito:
        // store_listings.productId é gravado como STRING (StoreListingService.create recebe
        // productId:string e passa direto ao Mongoose, sem cast — mesmo o schema declarando
        // Types.ObjectId). l.productId (de ListingModel.lean()) é um ObjectId real. Uma query
        // direta ao Model comparando ObjectId com string falha silenciosamente (BSON não
        // faz coerção nessa comparação fora do path-casting do Mongoose). O service já
        // recebe/compara sempre como string internamente — usar o mesmo método que
        // backfill-store-listings.ts usa evita reproduzir esse mismatch aqui.
        const storeListing = await storeListingService.findByProductAndStore(String(l.productId), String(l.storeId));
        if (!storeListing) continue; // não deveria acontecer — storeId gravado implica StoreListing já existe
        const marketplaceTag = await resolveMarketplaceTag(String(l.marketplaceId));
        // storeListing.id (não ._id) é a string normalizada que StoreListingService retorna
        // — marketplace_listings.storeListingId também é gravado como string (mesmo padrão
        // de create() acima), então comparar string-com-string aqui.
        const existing = await marketplaceListingModel
          .findOne({ storeListingId: storeListing.id, marketplaceTag, externalId: l.externalId ?? null })
          .lean()
          .exec();
        if (existing) continue; // já criado, nada a fazer
        storeIdByListingId.set(String(l._id), String(l.storeId));
        rowsNeedingMarketplaceListing.push({
          _id: l._id,
          productId: l.productId,
          marketplaceId: l.marketplaceId,
          externalId: l.externalId,
          status: l.status,
          createdByUserId: null,
        });
      }

      if (rowsNeedingMarketplaceListing.length > 0) {
        // resolveStore aqui não resolve por createdByUserId (não faz sentido
        // pra este script) — cada listing deste lote já tem um storeId
        // conhecido, capturado em storeIdByListingId acima. backfillStoreListings
        // chama resolveStore(listing.createdByUserId) uma vez por listing, na
        // MESMA ordem em que itera `listings` — usamos uma fila (queue) dos
        // storeIds na ordem exata de rowsNeedingMarketplaceListing para que
        // cada chamada devolva o storeId certo, sem depender do parâmetro
        // createdByUserId (que aqui é sempre null, apenas placeholder de tipo).
        const storeIdQueue = rowsNeedingMarketplaceListing.map((r) => storeIdByListingId.get(String(r._id))!);
        let queueIndex = 0;
        const resolveStoreFromQueue = async (_createdByUserId: Types.ObjectId | null): Promise<string> => {
          const storeId = storeIdQueue[queueIndex];
          queueIndex++;
          return storeId;
        };

        const batchSummary = await backfillStoreListings({
          listings: rowsNeedingMarketplaceListing,
          resolveStore: resolveStoreFromQueue,
          storeListingService: {
            findByProductAndStore: storeListingService.findByProductAndStore.bind(storeListingService),
            create: storeListingService.create.bind(storeListingService),
            createMarketplaceListing: storeListingService.createMarketplaceListing.bind(storeListingService),
          },
          resolveMarketplaceTag,
          resolveAccountId,
          listingModel: { updateOne: (async () => ({})) as any }, // storeId já gravado, no-op
          dryRun,
        });
        aggregateSummary.totalListings += batchSummary.totalListings;
        aggregateSummary.storeListingsReused += batchSummary.storeListingsReused;
        aggregateSummary.storeListingsCreated += batchSummary.storeListingsCreated;
        aggregateSummary.marketplaceListingsCreated += batchSummary.marketplaceListingsCreated;
        aggregateSummary.marketplaceListingsReused += batchSummary.marketplaceListingsReused;
        aggregateSummary.skippedNoAccount += batchSummary.skippedNoAccount;
      }

      processed += batch.length;
      console.log(`  ... verificados ${processed} listings (com storeId)`);
      skip += BATCH_SIZE;
    }

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, aggregateSummary);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
