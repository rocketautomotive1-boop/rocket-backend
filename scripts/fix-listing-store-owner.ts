// backend/scripts/fix-listing-store-owner.ts
/**
 * Corrige ListingModel.storeId para os 329 listings legados que nunca tiveram storeId
 * gravado, E para os listings que a Fase 2 (backfill-store-listings.ts) atribuiu
 * incorretamente à loja fallback "Rocket Automotive" por falta de
 * product.createdByUserId (99,99% dos produtos não têm esse campo) — quando na
 * verdade o listing carrega um sinal mais forte e 100% confiável: quem de fato
 * publicou (marketplaceData.userId). Achado em 2026-08-14 investigando um produto
 * de Djalma/RCK_AUTOMOTIVE publicado sob a conta MAXESHOP.
 *
 * Escopo: SÓ ListingModel.storeId. Não cria/atualiza StoreListing/MarketplaceListing/
 * estoque (isso é responsabilidade do dual-write existente — ver
 * ListingService.mirrorToStoreListing — que roda automaticamente na próxima
 * create()/update()/createOrUpdate() daquele listing, criando a StoreListing correta
 * sob demanda). Por isso, este script PULA explicitamente qualquer listing cujo
 * produto já tenha uma StoreListing real (com stock/marketplace_listings) sob a loja
 * errada — esses exigem migração manual dos dados já espelhados, fora de escopo aqui
 * (ver relatório separado gerado por report-wrong-store-listings.ts).
 *
 * Uso:
 *   npx ts-node scripts/fix-listing-store-owner.ts              # dry-run
 *   npx ts-node scripts/fix-listing-store-owner.ts --execute     # grava
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';
import { Model, Types } from 'mongoose';
// Type-only imports — ver comentário equivalente em backfill-store-listings.ts:
// evita puxar o grafo de dependências do Nest (incl. uuid, ESM-only) para dentro
// do arquivo de teste que importa a lógica pura deste script.
import type { ListingDocument } from '../src/listing/schemas/listing.schema';

export interface OwnerFixListingRow {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  storeId: Types.ObjectId | null;
  operatorUserId: string | null; // listing.marketplaceData.userId
}

export interface OwnerFixSummary {
  totalCandidates: number;
  resolvedViaOperator: number;
  unresolvedNoSignal: number;
  skippedConflictingStoreListing: number;
  corrected: number;
  alreadyCorrect: number;
}

/**
 * Resolve o storeId "correto" de um listing a partir de quem de fato publicou
 * (marketplaceData.userId → user.storeId). Retorna null se o listing não tem
 * operador gravado, ou se o operador não tem storeId configurado — nesses casos
 * o listing fica de fora da correção (não força nenhuma loja).
 */
export async function resolveCorrectStoreId(
  operatorUserId: string | null,
  userStoreIdLookup: (userId: string) => Promise<string | null>,
): Promise<string | null> {
  if (!operatorUserId) return null;
  const storeId = await userStoreIdLookup(operatorUserId);
  if (!storeId || !Types.ObjectId.isValid(storeId)) return null;
  return storeId;
}

export async function fixListingStoreOwner(params: {
  listings: OwnerFixListingRow[];
  userStoreIdLookup: (userId: string) => Promise<string | null>;
  /** true se já existe uma StoreListing (com dados reais) para (productId, listing.storeId atual) — conflito que exige migração manual, não correção automática. */
  hasConflictingStoreListing: (productId: Types.ObjectId, currentStoreId: Types.ObjectId | null) => Promise<boolean>;
  listingModel: Pick<Model<ListingDocument>, 'updateOne'>;
  dryRun: boolean;
}): Promise<OwnerFixSummary> {
  const { listings, userStoreIdLookup, hasConflictingStoreListing, listingModel, dryRun } = params;

  const summary: OwnerFixSummary = {
    totalCandidates: listings.length,
    resolvedViaOperator: 0,
    unresolvedNoSignal: 0,
    skippedConflictingStoreListing: 0,
    corrected: 0,
    alreadyCorrect: 0,
  };

  for (const listing of listings) {
    const correctStoreId = await resolveCorrectStoreId(listing.operatorUserId, userStoreIdLookup);

    if (!correctStoreId) {
      summary.unresolvedNoSignal++;
      continue;
    }
    summary.resolvedViaOperator++;

    if (listing.storeId && String(listing.storeId) === correctStoreId) {
      summary.alreadyCorrect++;
      continue;
    }

    const conflict = await hasConflictingStoreListing(listing.productId, listing.storeId);
    if (conflict) {
      summary.skippedConflictingStoreListing++;
      continue;
    }

    if (!dryRun) {
      await listingModel.updateOne({ _id: listing._id }, { $set: { storeId: new Types.ObjectId(correctStoreId) } });
    }
    summary.corrected++;
  }

  return summary;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { UserModel } = require('../src/auth/schemas/user.schema');
  const { StoreListingModel } = require('../src/store-listing/schemas/store-listing.schema');
  const { StoreListingStockBalanceModel } = require('../src/store-listing/schemas/store-listing-stock-balance.schema');
  const { MarketplaceListingModel } = require('../src/store-listing/schemas/marketplace-listing.schema');

  const dryRun = !process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name)) as Model<ListingDocument>;
    const userModel = app.get(getModelToken(UserModel.name)) as Model<any>;
    const storeListingModel = app.get(getModelToken(StoreListingModel.name)) as Model<any>;
    const balanceModel = app.get(getModelToken(StoreListingStockBalanceModel.name)) as Model<any>;
    const marketplaceListingModel = app.get(getModelToken(MarketplaceListingModel.name)) as Model<any>;

    const userStoreIdLookup = async (userId: string): Promise<string | null> => {
      const user = await userModel.findById(userId).lean().exec();
      return user?.storeId ?? null;
    };

    // Conflito = já existe StoreListing para (productId, storeId atual do listing) com
    // saldo real OU marketplace_listings publicados — migrar isso é trabalho manual,
    // fora de escopo deste script (ver riscos no spec).
    const hasConflictingStoreListing = async (
      productId: Types.ObjectId,
      currentStoreId: Types.ObjectId | null,
    ): Promise<boolean> => {
      if (!currentStoreId) return false; // sem storeId atual: nada a conflitar, é o caso dos 329 originais
      const sl = await storeListingModel.findOne({ productId, storeId: currentStoreId }).lean().exec();
      if (!sl) return false;
      const [balance, ml] = await Promise.all([
        balanceModel.findOne({ storeListingId: sl._id, onHand: { $gt: 0 } }).lean().exec(),
        marketplaceListingModel.findOne({ storeListingId: sl._id }).lean().exec(),
      ]);
      return !!balance || !!ml;
    };

    // Candidatos: listings SEM storeId (329 originais) OU com storeId = Rocket Automotive
    // (fallback fixo da Fase 2) — sempre que tiverem marketplaceData.userId gravado.
    const ROCKET_FALLBACK_STORE_ID = new Types.ObjectId('6a7cff4bf323afb241284d0c');
    const candidates = await listingModel
      .find({
        'marketplaceData.userId': { $exists: true },
        $or: [{ storeId: { $exists: false } }, { storeId: ROCKET_FALLBACK_STORE_ID }],
      })
      .select({ _id: 1, productId: 1, storeId: 1, 'marketplaceData.userId': 1 })
      .lean()
      .exec();

    const rows: OwnerFixListingRow[] = candidates.map((l: any) => ({
      _id: l._id,
      productId: l.productId,
      storeId: l.storeId ?? null,
      operatorUserId: l.marketplaceData?.userId ?? null,
    }));

    console.log(`Candidatos encontrados: ${rows.length}`);

    const summary = await fixListingStoreOwner({
      listings: rows,
      userStoreIdLookup,
      hasConflictingStoreListing,
      listingModel,
      dryRun,
    });

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo:`, summary);
    if (summary.skippedConflictingStoreListing > 0) {
      console.log(
        `\n⚠️  ${summary.skippedConflictingStoreListing} listing(s) pulados por conflito real (StoreListing com estoque/anúncio sob a loja errada) — precisam de migração manual, ver report-wrong-store-listings.ts.`,
      );
    }
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
