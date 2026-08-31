// backend/scripts/fix-listing-storeid-vs-accountid.ts
/**
 * Corrige ListingModel.storeId para listings ML cujo storeId diverge da loja derivada do próprio
 * ListingModel.accountId — o snapshot da conta DONA gravado uma única vez na criação do listing
 * (ver [[ml-403-owner-account-routing]]), mais confiável que uma verificação nova contra a API do
 * ML porque não depende de rate-limit/token e não é redundante com verify-listing-store-owner-ml.ts
 * (que já confirmou 2801/2837 listings corretos e não pegou este padrão: casos onde o MESMO
 * productId tem Listings legítimos em lojas DIFERENTES — ex. MLB6407949938 conta autopecas-default
 * vs. MLB5086697899 conta RCK_AUTOMOTIVE, mesmo productId — que o dedupe-por-produto de
 * transfer-store-listing-ownership.ts pula de propósito).
 *
 * Só usa StoreListingOwnershipService.transferOwnership (nunca ListingModel.updateOne direto —
 * ver aviso em ownership-transfer.service.ts) para manter Listing.storeId + StoreListing +
 * balances/lots/movements/marketplace_listings consistentes.
 *
 * Escopo: listings ML com accountId preenchido E storeId apontando para uma loja diferente da
 * loja mapeada para esse accountId. Reporta separadamente os casos sem loja mapeada pro accountId
 * (não corrige — não há destino válido).
 *
 * Uso:
 *   npx ts-node scripts/fix-listing-storeid-vs-accountid.ts              # dry-run
 *   npx ts-node scripts/fix-listing-storeid-vs-accountid.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Types } from 'mongoose';

export interface CandidateRow {
  productId: Types.ObjectId;
  listingId: Types.ObjectId;
  externalId: string;
  accountId: string;
  currentStoreId: Types.ObjectId;
}

export interface FixSummary {
  totalCandidates: number;
  noStoreMappedForAccount: number;
  repointed: number;
  merged: number;
  blocked: number;
  failed: number;
}

/**
 * Lógica pura: para cada candidato (Listing com accountId != loja-atual), resolve a loja correta
 * a partir do accountId e chama transferOwnership. Uma falha individual não interrompe os demais.
 */
export async function fixListingStoreIdVsAccountId(params: {
  candidates: CandidateRow[];
  resolveStoreForAccount: (accountId: string) => Promise<Types.ObjectId | null>;
  transferOwnership: (p: {
    productId: string;
    fromStoreId: string;
    toStoreId: string;
    reason: string;
    triggeredBy: string;
    dryRun: boolean;
  }) => Promise<{ kind: 'noop' | 'repoint' | 'merge' }>;
  dryRun: boolean;
  onProgress?: (row: CandidateRow, outcome: string) => void;
}): Promise<FixSummary> {
  const { candidates, resolveStoreForAccount, transferOwnership, dryRun, onProgress } = params;

  const summary: FixSummary = {
    totalCandidates: candidates.length,
    noStoreMappedForAccount: 0,
    repointed: 0,
    merged: 0,
    blocked: 0,
    failed: 0,
  };

  for (const row of candidates) {
    const correctStoreId = await resolveStoreForAccount(row.accountId);
    if (!correctStoreId) {
      summary.noStoreMappedForAccount++;
      onProgress?.(row, 'no_store_mapped_for_account');
      continue;
    }

    try {
      const result = await transferOwnership({
        productId: String(row.productId),
        fromStoreId: String(row.currentStoreId),
        toStoreId: String(correctStoreId),
        reason:
          'Backfill 2026-08-31: Listing.storeId divergia da loja derivada do Listing.accountId ' +
          '(snapshot da conta dona gravado na criação) — caso de produto com Listings legítimos ' +
          'em lojas diferentes, fora do escopo do dedupe-por-produto de transfer-store-listing-ownership.ts.',
        triggeredBy: 'fix-listing-storeid-vs-accountid.ts',
        dryRun,
      });

      if (result.kind === 'repoint') summary.repointed++;
      else if (result.kind === 'merge') summary.merged++;
      onProgress?.(row, result.kind);
    } catch (err: any) {
      if (err?.message?.includes('boxId')) {
        summary.blocked++;
        onProgress?.(row, 'blocked');
      } else {
        summary.failed++;
        onProgress?.(row, `failed: ${err?.message}`);
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
  const { StoreService } = require('../src/store/services/store.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const { StoreListingOwnershipService } = require('../src/store-listing/ownership-transfer.service');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const storeService = app.get(StoreService);
    const marketplaceRegistry = app.get(MarketplaceRegistryService);
    const ownershipService = app.get(StoreListingOwnershipService);

    const marketplace = await marketplaceRegistry.findByTag('mercadolivre');
    if (!marketplace) throw new Error('Marketplace mercadolivre não encontrado.');
    const marketplaceId = String(marketplace._id);

    const listings = await listingModel
      .find({
        marketplaceId: new Types.ObjectId(marketplaceId),
        externalId: { $type: 'string' },
        accountId: { $type: 'string' },
      })
      .select({ productId: 1, externalId: 1, accountId: 1, storeId: 1 })
      .lean()
      .exec();

    console.log(`Listings ML com accountId gravado: ${listings.length}`);

    const candidates: CandidateRow[] = [];
    for (const l of listings) {
      const mappedStore = await storeService.resolveStoreForAccount('mercadolivre', l.accountId);
      const mappedStoreId = mappedStore ? String(mappedStore.id) : null;
      if (mappedStoreId && mappedStoreId !== String(l.storeId)) {
        candidates.push({
          productId: l.productId,
          listingId: l._id,
          externalId: l.externalId,
          accountId: l.accountId,
          currentStoreId: l.storeId,
        });
      }
    }

    console.log(`Candidatos (Listing.storeId != loja mapeada pro Listing.accountId): ${candidates.length}`);
    candidates.forEach((c) =>
      console.log(`  listing=${c.listingId} (${c.externalId}) produto=${c.productId} accountId=${c.accountId} storeId atual=${c.currentStoreId}`),
    );

    const outcomes: string[] = [];
    const summary = await fixListingStoreIdVsAccountId({
      candidates,
      resolveStoreForAccount: (accountId) =>
        storeService
          .resolveStoreForAccount('mercadolivre', accountId)
          .then((s: any) => (s ? new Types.ObjectId(s.id) : null)),
      transferOwnership: (p) => ownershipService.transferOwnership(p),
      dryRun,
      onProgress: (row, outcome) => {
        outcomes.push(`  listing=${row.listingId} (${row.externalId}) produto=${row.productId}: ${outcome}`);
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
    console.error('Fix FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
