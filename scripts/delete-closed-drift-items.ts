// backend/scripts/delete-closed-drift-items.ts
/**
 * Complementa fix-ml-account-drift.ts: os itens já fechados (status:closed) via
 * aquele script foram apenas pausados, não excluídos de fato. A pedido do
 * usuário (2026-08-14), aplica PUT deleted:true em cada um — exclusão real,
 * mesmo efeito confirmado no fallback de moderação (status vira inactive,
 * sub_status ganha 'deleted'). Usa o token da conta MAXESHOP (mesma conta que
 * fechou os itens originalmente).
 *
 * Roda DEPOIS de fix-ml-account-drift.ts já ter fechado+limpo+resincronizado —
 * não mexe no nosso banco (o listing já foi limpo/republicado naquela
 * execução), só garante que o item antigo no ML é removido de fato, não só
 * pausado.
 *
 * Uso:
 *   npx ts-node scripts/delete-closed-drift-items.ts             # dry-run
 *   npx ts-node scripts/delete-closed-drift-items.ts --execute    # grava
 */
import 'dotenv/config';

const EXTERNAL_IDS = [
  'MLB4857423187', 'MLB7191564666', 'MLB7191564170', 'MLB7191564098', 'MLB7191563880',
  'MLB7191544176', 'MLB7191543162', 'MLB7191543118', 'MLB4907402929', 'MLB4907402281',
  'MLB4907385335', 'MLB4954396103', 'MLB4954358837', 'MLB7390398298', 'MLB7390389806',
  'MLB7390290668', 'MLB7390203092', 'MLB7390068642', 'MLB5041403127', 'MLB5041371511',
  'MLB7399292778', 'MLB7399081162', 'MLB7398830030', 'MLB7398516376', 'MLB7397281776',
  'MLB7397279532', 'MLB5048453287', 'MLB5047768151', 'MLB5046945411',
  'MLB5046898399', 'MLB5046897835', 'MLB5046854923', 'MLB7408098230', 'MLB7407757746',
  'MLB7407382632', 'MLB7407327856', 'MLB7407155318', 'MLB7407135208', 'MLB7407132024',
  'MLB7406958634', 'MLB7406948318', 'MLB7406827690', 'MLB7406477272',
  'MLB7406456006', 'MLB7406199982', 'MLB5055010625', 'MLB5054948681',
  'MLB5054824069', 'MLB5054481149', 'MLB5054431319', 'MLB5054429395', 'MLB5054399783',
  'MLB5054377455', 'MLB5054189427', 'MLB5054116925', 'MLB5054064843',
  'MLB5053771855', 'MLB5053671873', 'MLB5053667285', 'MLB5053662693', 'MLB5053639053',
  'MLB5053387123', 'MLB5053383959',
]; // = os 62 já fechados (66 originais − 4 tratados separadamente pelo fallback deleted:true)

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { MarketplaceAuthService } = require('../src/marketplace/auth/services/marketplace-auth.service');
  const { MarketplaceRegistryService } = require('../src/marketplace/services/marketplace-registry.service');
  const axios = require('axios');

  const dryRun = !process.argv.includes('--execute');
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}Alvo: ${EXTERNAL_IDS.length} anúncio(s) a excluir de fato (deleted:true).`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const authService = app.get(MarketplaceAuthService);
    const registry = app.get(MarketplaceRegistryService);

    const ml = await registry.findByTag('mercadolivre');
    if (!ml) throw new Error('Marketplace mercadolivre não encontrado.');
    const maxeshopAccount = (ml.accounts || []).find((a: any) => a.label === 'MAXESHOP');
    if (!maxeshopAccount) throw new Error('Conta MAXESHOP não encontrada.');

    const token = await authService.ensureValidToken(String(ml._id), { accountId: String(maxeshopAccount._id) });
    if (!token?.accessToken) throw new Error('Token MAXESHOP indisponível.');
    const headers = { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' };

    let ok = 0;
    let failed = 0;
    for (const externalId of EXTERNAL_IDS) {
      if (dryRun) {
        console.log(`  [dry-run] ${externalId}: seria excluído (deleted:true).`);
        ok++;
        continue;
      }
      try {
        const res = await axios.put(`https://api.mercadolibre.com/items/${externalId}`, { deleted: 'true' }, { headers });
        console.log(`  [ok] ${externalId}: status=${res.data.status} sub_status=${JSON.stringify(res.data.sub_status)}`);
        ok++;
      } catch (err: any) {
        console.warn(`  [FALHA] ${externalId}: ${err?.response?.status} ${JSON.stringify(err?.response?.data ?? err?.message)}`);
        failed++;
      }
    }

    console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Resumo: ${ok}/${EXTERNAL_IDS.length} ok, ${failed} falhas.`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Delete FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
