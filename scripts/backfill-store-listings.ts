// backend/scripts/backfill-store-listings.ts
/**
 * Backfill de ListingModel -> StoreListing + MarketplaceListing (Fase 2
 * do plano StoreListing). Puramente aditivo: cria StoreListing/
 * MarketplaceListing novos e preenche ListingModel.storeId (campo já
 * existente, vazio) — nunca apaga/edita mais nada em ListingModel.
 * Idempotente: StoreListingService.create/createMarketplaceListing já
 * tratam duplicata (E11000/pré-existente) como BadRequestException; este
 * script captura esse caso pontualmente em createMarketplaceListing
 * (conta em marketplaceListingsReused) em vez de deixar propagar — rodar
 * o script duas vezes não deve lançar nem duplicar nada.
 *
 * Uso:
 *   npx ts-node scripts/backfill-store-listings.ts              # dry-run
 *   npx ts-node scripts/backfill-store-listings.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
// Value imports below are `import type` on purpose: this file's Nest/app graph
// transitively pulls in the `uuid` package (ESM-only), which Jest cannot parse
// (see product-discovery.service.ts -> uuid). backfillStoreListings() itself
// has zero runtime dependency on Nest wiring — it only needs the *types* for
// its parameter signature — so keeping these as type-only imports lets the
// test file (`backfill-store-listings.logic.spec.ts`) import
// backfillStoreListings without loading AppModule at all. The actual runtime
// values are lazily require()'d inside main(), which only ever runs via the
// CLI entrypoint (`node scripts/backfill-store-listings.ts`), never under Jest.
import type { StoreListingService } from '../src/store-listing/store-listing.service';
import type { StorePort } from '../src/store/ports/store.port';
import type { ListingDocument } from '../src/listing/schemas/listing.schema';

export interface ListingRow {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  marketplaceId: Types.ObjectId;
  externalId?: string;
  status: string;
  createdByUserId: Types.ObjectId | null;
}

export interface BackfillSummary {
  totalListings: number;
  resolvedViaOwner: number;
  resolvedViaFallback: number;
  storeListingsCreated: number;
  storeListingsReused: number;
  marketplaceListingsCreated: number;
  marketplaceListingsReused: number;
  skippedNoAccount: number;
}

export async function backfillStoreListings(params: {
  listings: ListingRow[];
  resolveStore: (createdByUserId: Types.ObjectId | null) => Promise<string>;
  storeListingService: Pick<StoreListingService, 'findByProductAndStore' | 'create' | 'createMarketplaceListing'>;
  resolveMarketplaceTag: (marketplaceId: string) => Promise<string>;
  resolveAccountId: (storeId: string, marketplaceTag: string) => Promise<string | null>;
  listingModel: Pick<Model<ListingDocument>, 'updateOne'>;
  dryRun: boolean;
}): Promise<BackfillSummary> {
  const {
    listings,
    resolveStore,
    storeListingService,
    resolveMarketplaceTag,
    resolveAccountId,
    listingModel,
    dryRun,
  } = params;

  const summary: BackfillSummary = {
    totalListings: listings.length,
    resolvedViaOwner: 0,
    resolvedViaFallback: 0,
    storeListingsCreated: 0,
    storeListingsReused: 0,
    marketplaceListingsCreated: 0,
    marketplaceListingsReused: 0,
    skippedNoAccount: 0,
  };

  for (const listing of listings) {
    const storeId = await resolveStore(listing.createdByUserId);
    if (listing.createdByUserId) summary.resolvedViaOwner++;
    else summary.resolvedViaFallback++;

    if (dryRun) continue;

    let storeListingId: string;
    const existing = await storeListingService.findByProductAndStore(String(listing.productId), storeId);
    if (existing) {
      storeListingId = existing.id;
      summary.storeListingsReused++;
    } else {
      const created = await storeListingService.create(String(listing.productId), storeId);
      storeListingId = created.id;
      summary.storeListingsCreated++;
    }

    const marketplaceTag = await resolveMarketplaceTag(String(listing.marketplaceId));
    const accountId = await resolveAccountId(storeId, marketplaceTag);

    if (!accountId) {
      console.warn(
        `  [skip] listing ${String(listing._id)}: loja ${storeId} sem conta configurada para ${marketplaceTag}.`,
      );
      summary.skippedNoAccount++;
    } else {
      try {
        await storeListingService.createMarketplaceListing(storeListingId, marketplaceTag, accountId);
        summary.marketplaceListingsCreated++;
      } catch (err: any) {
        if (err instanceof BadRequestException) {
          summary.marketplaceListingsReused++;
        } else {
          throw err;
        }
      }
    }

    await listingModel.updateOne({ _id: listing._id }, { $set: { storeId } });
  }

  return summary;
}

async function main() {
  // Lazily required: pulling these in at module scope would drag AppModule's
  // full dependency graph (including the ESM-only `uuid` package) into every
  // consumer of this file, including the Jest test for backfillStoreListings.
  // See the comment on the type-only imports above.
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { StoreListingService } = require('../src/store-listing/store-listing.service');
  const { MarketplaceConfigCacheService } = require('../src/marketplace/services/marketplace-config-cache.service');
  const { StoreService } = require('../src/store/services/store.service');
  const { STORE_PORT } = require('../src/store/ports/store.port');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { UserModel } = require('../src/auth/schemas/user.schema');
  const { ProductModel } = require('../src/product/schemas/product.schema');
  const { resolveOwnerStore } = require('../src/store-listing/resolve-owner-store');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const storeListingService = app.get(StoreListingService);
    const configCache = app.get(MarketplaceConfigCacheService);
    const storeService = app.get(StoreService);
    const storePort = app.get(STORE_PORT) as StorePort;
    const listingModel = app.get(getModelToken(ListingModel.name)) as Model<ListingDocument>;
    const userModel = app.get(getModelToken(UserModel.name)) as Model<any>;
    const productModel = app.get(getModelToken(ProductModel.name)) as Model<any>;

    const fallbackStore = await storeService.findByName('Rocket Automotive');
    if (!fallbackStore) {
      throw new Error("Loja padrão 'Rocket Automotive' não encontrada — não deveria acontecer em produção.");
    }

    const resolveStore = async (createdByUserId: Types.ObjectId | null): Promise<string> =>
      resolveOwnerStore({
        createdByUserId,
        fallbackStoreId: fallbackStore.id,
        userStoreIdLookup: async (userId: string) => {
          const user = await userModel.findById(userId).lean().exec();
          return user?.storeId ?? null;
        },
      });

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
    const aggregateSummary: BackfillSummary = {
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
      const batch = await listingModel
        .find({ storeId: { $exists: false } })
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();
      if (batch.length === 0) break;

      const productIds = batch.map((l) => String(l.productId));
      const products = await productModel
        .find({ _id: { $in: productIds } }, { createdByUserId: 1 })
        .lean()
        .exec();
      const createdByUserIdByProductId = new Map(
        products.map((p) => [String(p._id), p.createdByUserId ?? null]),
      );

      const rows: ListingRow[] = batch.map((l) => ({
        _id: l._id,
        productId: l.productId,
        marketplaceId: l.marketplaceId,
        externalId: l.externalId,
        status: l.status,
        createdByUserId: createdByUserIdByProductId.get(String(l.productId)) ?? null,
      }));

      const batchSummary = await backfillStoreListings({
        listings: rows,
        resolveStore,
        storeListingService,
        resolveMarketplaceTag,
        resolveAccountId,
        listingModel,
        dryRun,
      });

      aggregateSummary.totalListings += batchSummary.totalListings;
      aggregateSummary.resolvedViaOwner += batchSummary.resolvedViaOwner;
      aggregateSummary.resolvedViaFallback += batchSummary.resolvedViaFallback;
      aggregateSummary.storeListingsCreated += batchSummary.storeListingsCreated;
      aggregateSummary.storeListingsReused += batchSummary.storeListingsReused;
      aggregateSummary.marketplaceListingsCreated += batchSummary.marketplaceListingsCreated;
      aggregateSummary.marketplaceListingsReused += batchSummary.marketplaceListingsReused;
      aggregateSummary.skippedNoAccount += batchSummary.skippedNoAccount;

      processed += batch.length;
      console.log(`  ... processados ${processed} listings`);
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
