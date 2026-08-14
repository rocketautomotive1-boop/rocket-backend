// backend/scripts/fix-ml-account-drift.ts
/**
 * Corrige anúncios do Mercado Livre publicados fisicamente sob a conta MAXESHOP
 * mas cujo listing.storeId (já correto no nosso banco) aponta para RCK_AUTOMOTIVE
 * — os 69 casos confirmados pela auditoria de 2026-08-14
 * (scripts/audit-ml-account-drift.ts). Para cada externalId da lista:
 *
 *   1. Fecha o item no ML (PUT /items/:id {status:'closed'}) usando o token da
 *      conta MAXESHOP (via ensureValidToken com accountId explícito — nunca a
 *      conta ativa/padrão).
 *   2. Limpa o externalId/status do listing no nosso banco (o listing continua
 *      existindo, storeId já correto — só perde o vínculo com o anúncio fechado).
 *   3. Dispara requestSync (outbox) para o produto — o orchestrator cria um
 *      anúncio NOVO, resolvendo accountId via listing.storeId → RCK_AUTOMOTIVE
 *      automaticamente (fluxo já corrigido nesta sessão).
 *
 * IMPORTANTE: fechar um anúncio no ML é IRREVERSÍVEL — o anúncio novo criado no
 * passo 3 é um item novo (novo externalId), perde histórico/visitas/perguntas do
 * anúncio fechado. Rodar só depois de confirmação explícita.
 *
 * Uso:
 *   npx ts-node scripts/fix-ml-account-drift.ts               # dry-run
 *   npx ts-node scripts/fix-ml-account-drift.ts --execute      # grava
 *   npx ts-node scripts/fix-ml-account-drift.ts --execute --only=MLB123,MLB456  # subset
 *
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';

const DRIFT_EXTERNAL_IDS = [
  'MLB4857423187', 'MLB7191564666', 'MLB7191564170', 'MLB7191564098', 'MLB7191563880',
  'MLB7191544176', 'MLB7191543162', 'MLB7191543118', 'MLB4907402929', 'MLB4907402281',
  'MLB4907385335', 'MLB4954396103', 'MLB4954358837', 'MLB7390398298', 'MLB7390389806',
  'MLB7390290668', 'MLB7390203092', 'MLB7390068642', 'MLB5041403127', 'MLB5041371511',
  'MLB7399292778', 'MLB7399081162', 'MLB7398830030', 'MLB7398516376', 'MLB7397281776',
  'MLB7397279532', 'MLB5048453287', 'MLB5048305295', 'MLB5047768151', 'MLB5046945411',
  'MLB5046898399', 'MLB5046897835', 'MLB5046854923', 'MLB7408098230', 'MLB7407757746',
  'MLB7407382632', 'MLB7407327856', 'MLB7407155318', 'MLB7407135208', 'MLB7407132024',
  'MLB7406958634', 'MLB7406948318', 'MLB7406827690', 'MLB7406477272', 'MLB7406462982',
  'MLB7406456006', 'MLB7406199982', 'MLB7406181308', 'MLB5055010625', 'MLB5054948681',
  'MLB5054824069', 'MLB5054481149', 'MLB5054431319', 'MLB5054429395', 'MLB5054399783',
  'MLB5054377455', 'MLB5054189427', 'MLB5054123211', 'MLB5054116925', 'MLB5054064843',
  'MLB5053771855', 'MLB5053671873', 'MLB5053667285', 'MLB5053662693', 'MLB5053639053',
  'MLB5053387123', 'MLB5053383959',
];

export interface FixResult {
  externalId: string;
  productId: string;
  step: 'closed' | 'listing_cleared' | 'resync_requested' | 'error';
  ok: boolean;
  detail?: string;
}

export async function fixDriftItem(params: {
  externalId: string;
  listing: { _id: any; productId: any; storeId: any };
  closeOnMarketplace: (externalId: string) => Promise<void>;
  clearListing: (listingId: any) => Promise<void>;
  requestResync: (productId: string, requesterId?: string) => Promise<void>;
  requesterId?: string;
}): Promise<FixResult[]> {
  const { externalId, listing, closeOnMarketplace, clearListing, requestResync, requesterId } = params;
  const results: FixResult[] = [];
  const productId = String(listing.productId);

  try {
    await closeOnMarketplace(externalId);
    results.push({ externalId, productId, step: 'closed', ok: true });
  } catch (err: any) {
    results.push({ externalId, productId, step: 'closed', ok: false, detail: err?.message });
    return results; // não prossegue se não conseguiu fechar — evita perder o vínculo de um anúncio ainda ativo
  }

  try {
    await clearListing(listing._id);
    results.push({ externalId, productId, step: 'listing_cleared', ok: true });
  } catch (err: any) {
    results.push({ externalId, productId, step: 'listing_cleared', ok: false, detail: err?.message });
    return results;
  }

  try {
    await requestResync(productId, requesterId);
    results.push({ externalId, productId, step: 'resync_requested', ok: true });
  } catch (err: any) {
    results.push({ externalId, productId, step: 'resync_requested', ok: false, detail: err?.message });
  }

  return results;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { MarketplaceAuthService } = require('../src/marketplace/auth/services/marketplace-auth.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const { StoreService } = require('../src/store/services/store.service');
  const { OrchestratorPublisherService } = require('../src/marketplace-orchestrator/orchestrator-publisher.service');
  const axios = require('axios');

  const dryRun = !process.argv.includes('--execute');
  const onlyArg = process.argv.find((a: string) => a.startsWith('--only='));
  const onlyIds = onlyArg ? new Set(onlyArg.replace('--only=', '').split(',')) : null;
  const targets = onlyIds ? DRIFT_EXTERNAL_IDS.filter((id) => onlyIds.has(id)) : DRIFT_EXTERNAL_IDS;

  console.log(`${dryRun ? '[DRY-RUN] ' : ''}Alvo: ${targets.length} anúncio(s).`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const authService = app.get(MarketplaceAuthService);
    const registry = app.get(MarketplaceRegistryService);
    const storeService = app.get(StoreService);
    const publisher = app.get(OrchestratorPublisherService);

    const ml = await registry.findByTag('mercadolivre');
    if (!ml) throw new Error('Marketplace mercadolivre não encontrado.');
    const maxeshopAccount = (ml.accounts || []).find((a: any) => a.label === 'MAXESHOP');
    if (!maxeshopAccount) throw new Error('Conta MAXESHOP não encontrada em marketplaces.accounts.');
    const maxeshopAccountId = String(maxeshopAccount._id);

    const token = await authService.ensureValidToken(String(ml._id), { accountId: maxeshopAccountId });
    if (!token?.accessToken) throw new Error('Token MAXESHOP indisponível.');
    const headers = { Authorization: `Bearer ${token.accessToken}` };

    const closeOnMarketplace = async (externalId: string) => {
      if (dryRun) return;
      try {
        await axios.put(`https://api.mercadolibre.com/items/${externalId}`, { status: 'closed' }, { headers });
      } catch (err: any) {
        // Item em moderação (status:under_review, sub_status:forbidden) rejeita
        // qualquer transição de status ("item.status.not_modifiable") — o ML
        // trata isso como estado terminal e exige deleted:true diretamente em vez
        // de closed (confirmado em produção 2026-08-14: closed falha com 400,
        // deleted:true funciona e retorna status:inactive,
        // sub_status:[forbidden,deleted]).
        const code = err?.response?.data?.cause?.[0]?.code;
        if (code === 'item.status.not_modifiable') {
          await axios.put(`https://api.mercadolibre.com/items/${externalId}`, { deleted: 'true' }, { headers });
          return;
        }
        throw err;
      }
    };

    const clearListing = async (listingId: any) => {
      if (dryRun) return;
      await listingModel.updateOne(
        { _id: listingId },
        { $set: { status: 'pending_creation', synchronized: false }, $unset: { externalId: '', lastSyncAt: '', marketplaceData: '' } },
      );
    };

    const requestResync = async (productId: string) => {
      if (dryRun) return;
      await publisher.requestSync({ productId, reason: 'fix_ml_account_drift', requesterId: undefined });
    };

    const allResults: FixResult[] = [];
    for (const externalId of targets) {
      const listing = await listingModel.findOne({ marketplaceId: ml._id, externalId }).lean().exec();
      if (!listing) {
        console.warn(`  [skip] ${externalId}: listing não encontrado no banco.`);
        continue;
      }
      if (String(listing.storeId) === maxeshopAccountId) {
        console.warn(`  [skip] ${externalId}: storeId já é MAXESHOP — não é um caso de drift.`);
        continue;
      }

      const results = await fixDriftItem({
        externalId,
        listing,
        closeOnMarketplace,
        clearListing,
        requestResync,
      });
      allResults.push(...results);

      const failed = results.find((r) => !r.ok);
      if (failed) {
        console.warn(`  [FALHA] ${externalId} em '${failed.step}': ${failed.detail}`);
      } else {
        console.log(`  [ok] ${externalId} → produto ${results[0].productId}: fechado + limpo + resync solicitado.`);
      }
    }

    const succeeded = allResults.filter((r) => r.step === 'resync_requested' && r.ok).length;
    const failedCount = targets.length - succeeded;
    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo: ${succeeded}/${targets.length} concluídos com sucesso.`);
    if (failedCount > 0) console.log(`${failedCount} não concluídos — ver [FALHA] acima.`);
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
