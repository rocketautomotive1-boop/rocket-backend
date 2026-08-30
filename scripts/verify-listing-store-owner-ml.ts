// backend/scripts/verify-listing-store-owner-ml.ts
/**
 * Corrige ListingModel.storeId para listings do Mercado Livre cujo storeId aponta para a loja
 * errada — verificado contra a API REAL do ML (GET /items/{externalId} por conta), não contra
 * heurística indireta (marketplaceData.userId → user.storeId, o sinal que fix-listing-store-owner.ts
 * já usou e que se provou insuficiente aqui — ver
 * docs/superpowers/specs/2026-08-30-listing-store-owner-ml-verified-backfill-design.md).
 *
 * Achado em 2026-08-30: 1.391 listings publicados antes de 10/08 (quando as lojas Max Eshop/
 * RCK_AUTOMOTIVE passaram a existir formalmente) ficaram com storeId dessas lojas por causa do
 * backfill anterior, mas pertencem de fato, no Mercado Livre, à conta autopecas-default — a
 * conta MAXESHOP/RCK_AUTOMOTIVE nem consegue LER (GET, 403 access_denied) esses itens.
 *
 * Estratégia: testa a conta ATUALMENTE resolvida primeiro (a maioria já está correta — resolve
 * em 1 chamada). Só se falhar (403/erro), tenta as outras contas do marketplace em sequência até
 * achar a que lê o item com sucesso. Corrige storeId só com prova positiva (200 de alguma conta);
 * se nenhuma conta consegue ler, reporta "dono desconhecido" e NÃO corrige.
 *
 * Escopo: só ListingModel.storeId, só listings com externalId (sem externalId não há item no ML
 * pra verificar — não entra). Não toca StoreListing/estoque/fiscal.
 *
 * Uso:
 *   npx ts-node scripts/verify-listing-store-owner-ml.ts              # dry-run
 *   npx ts-node scripts/verify-listing-store-owner-ml.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Model, Types } from 'mongoose';
import type { ListingDocument } from '../src/listing/schemas/listing.schema';

const ML_ITEM_URL = (externalId: string) => `https://api.mercadolibre.com/items/${externalId}`;
const THROTTLE_MS = 250;

export interface VerifyListingRow {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  externalId: string;
  storeId: Types.ObjectId;
}

export interface AccountCandidate {
  accountId: string;
  accessToken: string;
}

export interface VerifySummary {
  totalCandidates: number;
  alreadyCorrect: number;
  correctedToAnotherAccount: number;
  unknownOwner: number;
  correctAccountNoStoreMapped: number;
  skippedConflictingStoreListing: number;
}

/** GET puro contra a API do ML — 200 = a conta lê o item (prova de propriedade), qualquer outro
 * status = não lê (403 access_denied é o caso normal para um não-dono; outros erros de rede/
 * transporte são tratados como "não lê" também, conservador — nunca assume propriedade sem 200). */
export async function canAccountReadItem(
  externalId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(ML_ITEM_URL(externalId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Resolve qual accountId de fato consegue ler o item, testando `currentAccountId` primeiro (mais
 * barato — a maioria já está correta) e as demais `otherAccounts` em sequência só se necessário.
 * Retorna null se nenhuma conta conseguir ler.
 */
export async function resolveTrueOwnerAccountId(
  externalId: string,
  currentAccountId: string | null,
  allAccounts: AccountCandidate[],
  readItem: (externalId: string, accessToken: string) => Promise<boolean>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string | null> {
  const ordered = [...allAccounts].sort((a, b) => {
    if (a.accountId === currentAccountId) return -1;
    if (b.accountId === currentAccountId) return 1;
    return 0;
  });

  for (const candidate of ordered) {
    const ok = await readItem(externalId, candidate.accessToken);
    if (ok) return candidate.accountId;
    await sleep(THROTTLE_MS);
  }
  return null;
}

export async function verifyListingStoreOwnerML(params: {
  listings: VerifyListingRow[];
  allAccounts: AccountCandidate[];
  resolveAccountId: (storeId: Types.ObjectId) => Promise<string | null>;
  resolveStoreForAccount: (accountId: string) => Promise<Types.ObjectId | null>;
  hasConflictingStoreListing: (productId: Types.ObjectId, currentStoreId: Types.ObjectId) => Promise<boolean>;
  readItem: (externalId: string, accessToken: string) => Promise<boolean>;
  listingModel: Pick<Model<ListingDocument>, 'updateOne'>;
  dryRun: boolean;
  onProgress?: (row: VerifyListingRow, outcome: string) => void;
}): Promise<VerifySummary> {
  const {
    listings,
    allAccounts,
    resolveAccountId,
    resolveStoreForAccount,
    hasConflictingStoreListing,
    readItem,
    listingModel,
    dryRun,
    onProgress,
  } = params;

  const summary: VerifySummary = {
    totalCandidates: listings.length,
    alreadyCorrect: 0,
    correctedToAnotherAccount: 0,
    unknownOwner: 0,
    correctAccountNoStoreMapped: 0,
    skippedConflictingStoreListing: 0,
  };

  for (const listing of listings) {
    const currentAccountId = await resolveAccountId(listing.storeId);

    const trueOwnerAccountId = await resolveTrueOwnerAccountId(
      listing.externalId,
      currentAccountId,
      allAccounts,
      readItem,
    );

    if (!trueOwnerAccountId) {
      summary.unknownOwner++;
      onProgress?.(listing, 'unknown_owner');
      continue;
    }

    if (trueOwnerAccountId === currentAccountId) {
      summary.alreadyCorrect++;
      onProgress?.(listing, 'already_correct');
      continue;
    }

    const correctStoreId = await resolveStoreForAccount(trueOwnerAccountId);
    if (!correctStoreId) {
      summary.correctAccountNoStoreMapped++;
      onProgress?.(listing, 'correct_account_no_store_mapped');
      continue;
    }

    const conflict = await hasConflictingStoreListing(listing.productId, listing.storeId);
    if (conflict) {
      summary.skippedConflictingStoreListing++;
      onProgress?.(listing, 'skipped_conflicting_store_listing');
      continue;
    }

    if (!dryRun) {
      await listingModel.updateOne({ _id: listing._id }, { $set: { storeId: correctStoreId } });
    }
    summary.correctedToAnotherAccount++;
    onProgress?.(listing, 'corrected');
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
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');
  const { StoreService } = require('../src/store/services/store.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const { MarketplaceTokenBrokerService } = require('../src/marketplace/auth/services/marketplace-token-broker.service');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name)) as Model<ListingDocument>;
    const storeListingModel = app.get(getModelToken(StoreListingModel.name)) as Model<any>;
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name)) as Model<any>;
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name)) as Model<any>;
    const storeService = app.get(StoreService);
    const marketplaceRegistry = app.get(MarketplaceRegistryService);
    const tokenBroker = app.get(MarketplaceTokenBrokerService);

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

    const candidates = await listingModel
      .find({ marketplaceId: new Types.ObjectId(marketplaceId), externalId: { $type: 'string' } })
      .select({ _id: 1, productId: 1, externalId: 1, storeId: 1 })
      .lean()
      .exec();

    const rows: VerifyListingRow[] = candidates.map((l: any) => ({
      _id: l._id,
      productId: l.productId,
      externalId: l.externalId,
      storeId: l.storeId,
    }));

    console.log(`Candidatos encontrados (ML, com externalId): ${rows.length}`);

    const resolveAccountId = (storeId: Types.ObjectId): Promise<string | null> =>
      storeService.resolveAccountId(String(storeId), 'mercadolivre');

    const resolveStoreForAccount = async (accountId: string): Promise<Types.ObjectId | null> => {
      const store = await storeService.resolveStoreForAccount('mercadolivre', accountId);
      return store ? new Types.ObjectId(store.id) : null;
    };

    const hasConflictingStoreListing = async (
      productId: Types.ObjectId,
      currentStoreId: Types.ObjectId,
    ): Promise<boolean> => {
      const sl = await storeListingModel.findOne({ productId, storeId: currentStoreId }).lean().exec();
      if (!sl) return false;
      const [balance, ml] = await Promise.all([
        balanceModel.findOne({ storeListingId: sl._id, onHand: { $gt: 0 } }).lean().exec(),
        marketplaceListingModel.findOne({ storeListingId: sl._id }).lean().exec(),
      ]);
      return !!balance || !!ml;
    };

    let processed = 0;
    const unknownOwnerRows: string[] = [];
    const correctedRows: string[] = [];

    const summary = await verifyListingStoreOwnerML({
      listings: rows,
      allAccounts,
      resolveAccountId,
      resolveStoreForAccount,
      hasConflictingStoreListing,
      readItem: canAccountReadItem,
      listingModel,
      dryRun,
      onProgress: (row, outcome) => {
        processed++;
        if (outcome === 'unknown_owner') unknownOwnerRows.push(`${row._id} (${row.externalId})`);
        if (outcome === 'corrected') correctedRows.push(`${row._id} (${row.externalId})`);
        if (processed % 50 === 0) console.log(`  ...${processed}/${rows.length} processados`);
      },
    });

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, summary);
    if (correctedRows.length > 0) {
      console.log(`\nListings corrigidos (${correctedRows.length}):\n  ${correctedRows.join('\n  ')}`);
    }
    if (unknownOwnerRows.length > 0) {
      console.log(`\n⚠️  Dono desconhecido, NÃO corrigidos (${unknownOwnerRows.length}):\n  ${unknownOwnerRows.join('\n  ')}`);
    }
    if (summary.skippedConflictingStoreListing > 0) {
      console.log(
        `\n⚠️  ${summary.skippedConflictingStoreListing} listing(s) pulados por conflito real (StoreListing com estoque/anúncio sob a loja atual) — precisam de migração manual.`,
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Verify FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
