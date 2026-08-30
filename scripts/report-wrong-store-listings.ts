// backend/scripts/report-wrong-store-listings.ts
/**
 * Relatório (somente leitura) dos casos onde ListingModel.storeId (já corrigido/verificado contra
 * a API real do ML por verify-listing-store-owner-ml.ts) diverge do StoreListing real materializado
 * pelo dual-write (ListingService.mirrorToStoreListing) — os casos que os dois scripts de backfill
 * anteriores (fix-listing-store-owner.ts, verify-listing-store-owner-ml.ts) detectaram via
 * hasConflictingStoreListing e PULARAM de propósito, porque corrigir só o storeId deixaria o
 * StoreListing/estoque/marketplace_listings materializados sob a loja errada.
 *
 * Este script não escreve nada — é o "relatório separado" mencionado nos comentários dos dois
 * scripts anteriores, nunca antes gerado. Serve para dimensionar o trabalho real de migração
 * (mover StoreListing + stock balances/lots/movements + marketplace_listings da loja errada pra
 * correta) antes de escrever o script de migração em si.
 *
 * Para cada listing ML com externalId cujo storeId aponta pra uma loja (A) mas já existe um
 * StoreListing "conflitante" (productId, A) com dados reais, o script:
 *   1. Confirma que existe também — ou não — um StoreListing (productId, storeId-do-listing) —
 *      redundante aqui pois storeId do listing já É a loja com conflito; o conflito É essa
 *      combinação.
 *   2. Reporta o que está materializado sob essa StoreListing errada: saldo (onHand/reserved por
 *      condition, com boxId se houver), lotes, quantidade de movimentos, marketplace_listings
 *      (com externalId/status).
 *   3. Reporta se JÁ existe um StoreListing (productId, storeId-correto-do-listing) — ou seja, se
 *      o destino da migração já está ocupado (precisaria merge, não só mover) ou está livre.
 *
 * Uso:
 *   npx ts-node scripts/report-wrong-store-listings.ts
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

export interface WrongStoreListingRow {
  productId: Types.ObjectId;
  listingStoreId: Types.ObjectId; // ListingModel.storeId — já verificado como correto contra a API do ML
  storeListingId: Types.ObjectId;
  storeListingStoreId: Types.ObjectId; // storeId do StoreListing materializado — a loja ERRADA
  balances: Array<{ condition: string; onHand: number; reserved: number; boxId: Types.ObjectId | null }>;
  lotCount: number;
  movementCount: number;
  damagedUnitCount: number;
  marketplaceListings: Array<{ marketplaceTag: string; externalId: string | null; status: string }>;
  destinationOccupied: boolean; // já existe StoreListing (productId, listingStoreId)?
  destinationStoreListingId: Types.ObjectId | null;
}

export interface WrongStoreListingReport {
  totalWrong: number;
  destinationFree: number;
  destinationOccupied: number;
  totalOnHandUnitsAffected: number;
  totalMarketplaceListingsAffected: number;
  rows: WrongStoreListingRow[];
}

/**
 * Lógica pura: recebe listings ML já com storeId correto (verificado), e para cada um checa se o
 * StoreListing materializado sob esse storeId é o mesmo que deveria existir, ou se há um
 * StoreListing "sobrando" sob outra loja com dados reais — o padrão exato que
 * hasConflictingStoreListing() detecta nos dois scripts anteriores, mas aqui reportando os DADOS
 * do conflito em vez de só um boolean.
 */
export async function reportWrongStoreListings(params: {
  listings: Array<{ productId: Types.ObjectId; correctStoreId: Types.ObjectId }>;
  findStoreListingsForProduct: (
    productId: Types.ObjectId,
  ) => Promise<Array<{ _id: Types.ObjectId; storeId: Types.ObjectId }>>;
  getBalances: (
    storeListingId: Types.ObjectId,
  ) => Promise<Array<{ condition: string; onHand: number; reserved: number; boxId: Types.ObjectId | null }>>;
  countLots: (storeListingId: Types.ObjectId) => Promise<number>;
  countMovements: (storeListingId: Types.ObjectId) => Promise<number>;
  countDamagedUnits: (storeListingId: Types.ObjectId) => Promise<number>;
  getMarketplaceListings: (
    storeListingId: Types.ObjectId,
  ) => Promise<Array<{ marketplaceTag: string; externalId: string | null; status: string }>>;
}): Promise<WrongStoreListingReport> {
  const {
    listings,
    findStoreListingsForProduct,
    getBalances,
    countLots,
    countMovements,
    countDamagedUnits,
    getMarketplaceListings,
  } = params;

  const rows: WrongStoreListingRow[] = [];
  const seenStoreListingIds = new Set<string>();

  for (const listing of listings) {
    const storeListings = await findStoreListingsForProduct(listing.productId);

    for (const sl of storeListings) {
      if (String(sl.storeId) === String(listing.correctStoreId)) continue; // essa é a certa, não é o problema
      if (seenStoreListingIds.has(String(sl._id))) continue; // já reportado (2 listings do mesmo produto podem apontar pro mesmo conflito)

      const [balances, lotCount, movementCount, damagedUnitCount, marketplaceListings] = await Promise.all([
        getBalances(sl._id),
        countLots(sl._id),
        countMovements(sl._id),
        countDamagedUnits(sl._id),
        getMarketplaceListings(sl._id),
      ]);

      const hasRealData =
        balances.some((b) => b.onHand > 0 || b.reserved > 0) || marketplaceListings.length > 0;
      if (!hasRealData) continue; // StoreListing vazia sob a loja errada não é o caso que nos interessa aqui

      seenStoreListingIds.add(String(sl._id));

      const destination = storeListings.find((x) => String(x.storeId) === String(listing.correctStoreId));

      rows.push({
        productId: listing.productId,
        listingStoreId: listing.correctStoreId,
        storeListingId: sl._id,
        storeListingStoreId: sl.storeId,
        balances,
        lotCount,
        movementCount,
        damagedUnitCount,
        marketplaceListings,
        destinationOccupied: !!destination,
        destinationStoreListingId: destination?._id ?? null,
      });
    }
  }

  const totalOnHandUnitsAffected = rows.reduce(
    (sum, r) => sum + r.balances.reduce((s, b) => s + b.onHand, 0),
    0,
  );
  const totalMarketplaceListingsAffected = rows.reduce((sum, r) => sum + r.marketplaceListings.length, 0);

  return {
    totalWrong: rows.length,
    destinationFree: rows.filter((r) => !r.destinationOccupied).length,
    destinationOccupied: rows.filter((r) => r.destinationOccupied).length,
    totalOnHandUnitsAffected,
    totalMarketplaceListingsAffected,
    rows,
  };
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

    // O storeId "de vitrine" do ListingModel NÃO é confiável por si só — verify-listing-store-owner-ml.ts
    // rodou só em dry-run (nunca gravou), então listing.storeId aqui ainda é o valor pré-correção.
    // Este relatório precisa do mesmo dono verificado contra a API real do ML, não do campo bruto —
    // senão casos onde listing.storeId E StoreListing.storeId concordam (ambos errados) somem do relatório.
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
    let unknownOwner = 0;

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

      if (!trueOwnerAccountId) {
        unknownOwner++;
        continue; // dono desconhecido — mesmo critério de verify-listing-store-owner-ml.ts, não força loja nenhuma
      }

      const correctStore = await storeService.resolveStoreForAccount('mercadolivre', trueOwnerAccountId);
      if (!correctStore) continue; // conta correta identificada mas sem loja mapeada — fora de escopo aqui também

      // Não sobrescreve se este produto já foi resolvido por outro listing (mesmo produto, múltiplos
      // títulos/listings) — mantém o primeiro dono verificado encontrado.
      if (!dedupedByProduct.has(String(l.productId))) {
        dedupedByProduct.set(String(l.productId), {
          productId: l.productId,
          correctStoreId: new Types.ObjectId(correctStore.id),
        });
      }
    }

    console.log(`Produtos com dono ML verificado: ${dedupedByProduct.size} (dono desconhecido: ${unknownOwner})`);

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

    console.log('\nResumo:', {
      totalWrong: report.totalWrong,
      destinationFree: report.destinationFree,
      destinationOccupied: report.destinationOccupied,
      totalOnHandUnitsAffected: report.totalOnHandUnitsAffected,
      totalMarketplaceListingsAffected: report.totalMarketplaceListingsAffected,
    });

    const withBoxId = report.rows.filter((r) => r.balances.some((b) => b.boxId));
    console.log(`\nCasos com boxId preenchido (depósito físico): ${withBoxId.length}`);

    const withDamaged = report.rows.filter((r) => r.damagedUnitCount > 0);
    console.log(`Casos com unidades avariadas: ${withDamaged.length}`);

    console.log(`\nDetalhe (${report.rows.length} linhas):`);
    for (const r of report.rows) {
      console.log(
        `  produto=${r.productId} storeListing=${r.storeListingId} lojaErrada=${r.storeListingStoreId} ` +
          `lojaCorreta=${r.listingStoreId} destino=${r.destinationOccupied ? `OCUPADO(${r.destinationStoreListingId})` : 'livre'} ` +
          `saldo=${JSON.stringify(r.balances)} lotes=${r.lotCount} movs=${r.movementCount} avariadas=${r.damagedUnitCount} ` +
          `ml=${JSON.stringify(r.marketplaceListings)}`,
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Report FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
