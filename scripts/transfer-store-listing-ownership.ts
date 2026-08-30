// backend/scripts/transfer-store-listing-ownership.ts
/**
 * Executa a migração real dos 883 casos encontrados por report-wrong-store-listings.ts (2026-08-30):
 * listings ML cujo dono verificado contra a API real (mesma lógica de verify-listing-store-owner-ml.ts)
 * diverge do StoreListing materializado pelo dual-write (ListingService.mirrorToStoreListing).
 *
 * Ao contrário dos scripts anteriores (fix-listing-store-owner.ts, verify-listing-store-owner-ml.ts —
 * que tocam só ListingModel.storeId e PULAM de propósito qualquer caso com StoreListing real
 * conflitante), este script usa StoreListingOwnershipService.transferOwnership — a operação de
 * domínio que move atomicamente ListingModel.storeId + StoreListing + balances/lots/movements/
 * marketplace_listings/damaged_units. Ver ownership-transfer.logic.ts para o design completo.
 *
 * Escopo confirmado pelo relatório: 883 casos, 852 repoint (destino livre) + 31 merge (destino
 * ocupado), 0 com boxId preenchido, 0 com unidades avariadas — dentro do que transferOwnership
 * suporta. Um caso com boxId preenchido faz a operação individual lançar (bloqueado, não corrompe
 * nada) e o script segue para o próximo, reportando no resumo.
 *
 * Uso:
 *   npx ts-node scripts/transfer-store-listing-ownership.ts              # dry-run
 *   npx ts-node scripts/transfer-store-listing-ownership.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Types } from 'mongoose';
import {
  canAccountReadItem,
  resolveTrueOwnerAccountId,
  AccountCandidate,
} from './verify-listing-store-owner-ml';
import { reportWrongStoreListings } from './report-wrong-store-listings';

export interface MigrationSummary {
  totalCandidates: number;
  repointed: number;
  merged: number;
  noop: number;
  blocked: number;
  failed: number;
}

/**
 * Lógica pura: dado o conjunto de casos já identificados (productId + storeId errado + storeId
 * correto), chama a operação de transferência uma vez por caso, contabilizando o resultado. Uma
 * falha individual (ex. boxId bloqueado, conflito de merge) não interrompe os demais casos — cada
 * transferOwnership já é atômica isoladamente.
 */
export async function migrateOwnership(params: {
  cases: Array<{ productId: Types.ObjectId; fromStoreId: Types.ObjectId; toStoreId: Types.ObjectId }>;
  transferOwnership: (params: {
    productId: string;
    fromStoreId: string;
    toStoreId: string;
    reason: string;
    triggeredBy: string;
    dryRun: boolean;
  }) => Promise<{ kind: 'noop' | 'repoint' | 'merge' }>;
  dryRun: boolean;
  onProgress?: (
    row: { productId: Types.ObjectId; fromStoreId: Types.ObjectId; toStoreId: Types.ObjectId },
    outcome: string,
  ) => void;
}): Promise<MigrationSummary> {
  const { cases, transferOwnership, dryRun, onProgress } = params;

  const summary: MigrationSummary = {
    totalCandidates: cases.length,
    repointed: 0,
    merged: 0,
    noop: 0,
    blocked: 0,
    failed: 0,
  };

  for (const c of cases) {
    try {
      const result = await transferOwnership({
        productId: String(c.productId),
        fromStoreId: String(c.fromStoreId),
        toStoreId: String(c.toStoreId),
        reason: 'Backfill 2026-08-30: storeId verificado contra API real do ML divergia do StoreListing materializado (ver report-wrong-store-listings.ts).',
        triggeredBy: 'transfer-store-listing-ownership.ts',
        dryRun,
      });

      if (result.kind === 'noop') summary.noop++;
      else if (result.kind === 'repoint') summary.repointed++;
      else if (result.kind === 'merge') summary.merged++;
      onProgress?.(c, result.kind);
    } catch (err: any) {
      if (err?.message?.includes('boxId')) {
        summary.blocked++;
        onProgress?.(c, 'blocked');
      } else {
        summary.failed++;
        onProgress?.(c, `failed: ${err?.message}`);
      }
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
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { StoreListingStockLotModel } = require('../src/store-listing/schemas/store-listing-stock-lot.schema');
  const { StoreListingStockMovementModel } = require('../src/store-listing/schemas/store-listing-stock-movement.schema');
  const { StoreListingDamagedUnitModel } = require('../src/store-listing/schemas/store-listing-damaged-unit.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');
  const { StoreService } = require('../src/store/services/store.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const { MarketplaceTokenBrokerService } = require('../src/marketplace/auth/services/marketplace-token-broker.service');
  const { StoreListingOwnershipService } = require('../src/store-listing/ownership-transfer.service');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const storeListingModel = app.get(getModelToken(StoreListingModel.name));
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name));
    const lotModel = app.get(getModelToken(StoreListingStockLotModel.name));
    const movementModel = app.get(getModelToken(StoreListingStockMovementModel.name));
    const damagedUnitModel = app.get(getModelToken(StoreListingDamagedUnitModel.name));
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name));
    const storeService = app.get(StoreService);
    const marketplaceRegistry = app.get(MarketplaceRegistryService);
    const tokenBroker = app.get(MarketplaceTokenBrokerService);
    const ownershipService = app.get(StoreListingOwnershipService);

    const marketplace = await marketplaceRegistry.findByTag('mercadolivre');
    if (!marketplace) throw new Error('Marketplace mercadolivre não encontrado.');
    const marketplaceId = String(marketplace._id);

    const accountRefs: Array<{ accountId: string; label: string }> = await tokenBroker.listAccountsWithToken(marketplaceId);
    console.log(`Contas ML com token: ${accountRefs.map((a) => a.label).join(', ')}`);

    const allAccounts: AccountCandidate[] = [];
    for (const ref of accountRefs) {
      const resolved = await tokenBroker.ensureValidTokenByAccount(marketplaceId, ref.accountId);
      if (resolved?.accessToken) {
        allAccounts.push({ accountId: ref.accountId, accessToken: resolved.accessToken });
      }
    }

    const listingRows = await listingModel
      .find({ marketplaceId: new Types.ObjectId(marketplaceId), externalId: { $type: 'string' } })
      .select({ productId: 1, storeId: 1, externalId: 1 })
      .lean()
      .exec();

    console.log(`Listings ML com externalId: ${listingRows.length}`);

    const dedupedByProduct = new Map<string, { productId: Types.ObjectId; correctStoreId: Types.ObjectId }>();
    let processed = 0;

    for (const l of listingRows) {
      processed++;
      if (processed % 100 === 0) console.log(`  ...verificando dono real: ${processed}/${listingRows.length}`);

      const currentAccountId: string | null = await storeService.resolveAccountId(String(l.storeId), 'mercadolivre');
      const trueOwnerAccountId = await resolveTrueOwnerAccountId(
        l.externalId,
        currentAccountId,
        allAccounts,
        canAccountReadItem,
      );
      if (!trueOwnerAccountId) continue;

      const correctStore = await storeService.resolveStoreForAccount('mercadolivre', trueOwnerAccountId);
      if (!correctStore) continue;

      if (!dedupedByProduct.has(String(l.productId))) {
        dedupedByProduct.set(String(l.productId), {
          productId: l.productId,
          correctStoreId: new Types.ObjectId(correctStore.id),
        });
      }
    }

    console.log(`Produtos com dono ML verificado: ${dedupedByProduct.size}`);

    const report = await reportWrongStoreListings({
      listings: Array.from(dedupedByProduct.values()),
      findStoreListingsForProduct: (productId) =>
        storeListingModel.find({ productId }).select({ storeId: 1 }).lean().exec(),
      getBalances: (storeListingId) =>
        balanceModel
          .find({ storeListingId })
          .select({ condition: 1, onHand: 1, reserved: 1, boxId: 1 })
          .lean()
          .exec(),
      countLots: (storeListingId) => lotModel.countDocuments({ storeListingId }).exec(),
      countMovements: (storeListingId) => movementModel.countDocuments({ storeListingId }).exec(),
      countDamagedUnits: (storeListingId) => damagedUnitModel.countDocuments({ storeListingId }).exec(),
      getMarketplaceListings: (storeListingId) =>
        marketplaceListingModel
          .find({ storeListingId })
          .select({ marketplaceTag: 1, externalId: 1, status: 1 })
          .lean()
          .exec(),
    });

    console.log(`\nCasos a migrar: ${report.totalWrong} (repoint: ${report.destinationFree}, merge: ${report.destinationOccupied})`);

    const cases = report.rows.map((r) => ({
      productId: r.productId,
      fromStoreId: r.storeListingStoreId,
      toStoreId: r.listingStoreId,
    }));

    const outcomes: string[] = [];

    const summary = await migrateOwnership({
      cases,
      transferOwnership: (p) => ownershipService.transferOwnership(p),
      dryRun,
      onProgress: (row, outcome) => {
        outcomes.push(`  produto=${row.productId} ${row.fromStoreId}→${row.toStoreId}: ${outcome}`);
      },
    });

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, summary);
    console.log(`\nDetalhe:\n${outcomes.join('\n')}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Migration FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
