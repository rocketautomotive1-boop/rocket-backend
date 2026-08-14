// backend/scripts/audit-ml-account-drift.ts
/**
 * Auditoria read-only: para cada conta ML configurada, busca via API real quais
 * externalIds estão publicados nela, e compara com o storeId gravado no nosso
 * banco para o listing correspondente — detecta "drift" (anúncio fisicamente
 * publicado numa conta, mas o listing aponta para uma loja cuja conta seria
 * outra), o caso real que motivou toda a investigação de 2026-08-14
 * (MLB5054377455, então sob MAXESHOP mas dono real RCK_AUTOMOTIVE).
 *
 * NUNCA escreve nada — nem no nosso banco, nem no ML. Só relatório.
 *
 * Uso: npx ts-node scripts/audit-ml-account-drift.ts
 * Requer no .env: MONGO_URI.
 */
import 'dotenv/config';

interface DriftRow {
  externalId: string;
  publishedUnderAccountLabel: string;
  publishedUnderAccountId: string;
  ourStoreId: string | null;
  ourStoreName: string;
  ourStoreExpectedAccountId: string | null;
  ourStoreExpectedAccountLabel: string;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { getModelToken } = require('@nestjs/mongoose');
  const { AppModule } = require('../src/app.module');
  const { ListingModel } = require('../src/listing/schemas/listing.schema');
  const { MarketplaceAuthService } = require('../src/marketplace/auth/services/marketplace-auth.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const { STORE_PORT } = require('../src/store/ports/store.port');
  const axios = require('axios');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const listingModel = app.get(getModelToken(ListingModel.name));
    const authService = app.get(MarketplaceAuthService);
    const registry = app.get(MarketplaceRegistryService);
    const storePort = app.get(STORE_PORT);

    const ml = await registry.findByTag('mercadolivre');
    if (!ml) throw new Error('Marketplace mercadolivre não encontrado.');

    const accounts: Array<{ _id: any; label: string }> = (ml.accounts || []).map((a: any) => ({
      _id: a._id,
      label: a.label,
    }));
    console.log(`Contas ML configuradas: ${accounts.map((a) => a.label).join(', ')}`);

    // 1. Para cada conta, busca TODOS os externalIds publicados nela via API real.
    const externalIdToAccount = new Map<string, { accountId: string; label: string }>();

    for (const account of accounts) {
      const accountId = String(account._id);
      let token;
      try {
        token = await authService.ensureValidToken(String(ml._id), { accountId });
      } catch (err: any) {
        console.warn(`  [skip] conta ${account.label}: token indisponível (${err?.message})`);
        continue;
      }
      if (!token?.accessToken) {
        console.warn(`  [skip] conta ${account.label}: sem accessToken.`);
        continue;
      }

      try {
        const headers = { Authorization: `Bearer ${token.accessToken}` };
        const me = await axios.get('https://api.mercadolibre.com/users/me', { headers });
        const sellerId = me.data.id;

        let offset = 0;
        let total = Infinity;
        let count = 0;
        while (offset < total) {
          const res = await axios.get(`https://api.mercadolibre.com/users/${sellerId}/items/search`, {
            headers,
            params: { offset, limit: 50 },
          });
          total = res.data.paging?.total ?? 0;
          const ids: string[] = res.data.results || [];
          for (const id of ids) externalIdToAccount.set(id, { accountId, label: account.label });
          count += ids.length;
          offset += 50;
          if (ids.length === 0) break;
        }
        console.log(`  conta ${account.label} (seller ${sellerId}): ${count} itens publicados.`);
      } catch (err: any) {
        console.warn(`  [skip] conta ${account.label}: falha na API do ML (${err?.response?.status ?? ''} ${err?.message})`);
        continue;
      }
    }

    console.log(`\nTotal de externalIds encontrados nas ${accounts.length} contas: ${externalIdToAccount.size}`);

    // 2. Para cada externalId encontrado, resolve a loja/conta esperada no NOSSO banco.
    const drift: DriftRow[] = [];
    const storeCache = new Map<string, any>();
    const storeAccountCache = new Map<string, string | null>();

    for (const [externalId, published] of externalIdToAccount) {
      const listing = await listingModel.findOne({ marketplaceId: ml._id, externalId }).lean().exec();
      if (!listing) continue; // publicado no ML mas sem registro nosso — fora de escopo aqui

      const storeIdStr = listing.storeId ? String(listing.storeId) : null;
      let storeName = '(sem storeId)';
      let expectedAccountId: string | null = null;
      let expectedAccountLabel = '(nenhuma)';

      if (storeIdStr) {
        if (!storeCache.has(storeIdStr)) {
          storeCache.set(storeIdStr, true);
        }
        if (!storeAccountCache.has(storeIdStr)) {
          const resolved = await storePort.resolveAccountId(storeIdStr, 'mercadolivre');
          storeAccountCache.set(storeIdStr, resolved);
        }
        expectedAccountId = storeAccountCache.get(storeIdStr) ?? null;
        const acc = accounts.find((a) => String(a._id) === String(expectedAccountId));
        expectedAccountLabel = acc?.label ?? '(conta não encontrada)';
      }

      if (expectedAccountId !== published.accountId) {
        drift.push({
          externalId,
          publishedUnderAccountLabel: published.label,
          publishedUnderAccountId: published.accountId,
          ourStoreId: storeIdStr,
          ourStoreName: storeName,
          ourStoreExpectedAccountId: expectedAccountId,
          ourStoreExpectedAccountLabel: expectedAccountLabel,
        });
      }
    }

    console.log(`\n=== DRIFT ENCONTRADO: ${drift.length} anúncio(s) ===\n`);
    for (const d of drift) {
      const product = await listingModel.findOne({ marketplaceId: ml._id, externalId: d.externalId }).lean().exec();
      console.log(
        `externalId=${d.externalId} | publicado sob=${d.publishedUnderAccountLabel} | ` +
        `nosso storeId espera conta=${d.ourStoreExpectedAccountLabel} | productId=${product?.productId}`,
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Audit FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
