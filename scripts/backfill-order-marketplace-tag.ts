/**
 * BACKFILL de `Order.marketplaceTag`: nome de exibição → tag técnica.
 *
 * Contexto: order-mapper.service.ts sempre gravou marketplaceName (ex: "Mercado Livre",
 * "Rocket") em Order.marketplaceTag, mas a resolução fiscal (StoreService.resolveStoreForAccount/
 * resolveFiscalChannel) compara contra Store.marketplaceAccounts[].marketplaceTag, que usa a
 * TAG técnica (ex: "mercadolivre", "rocket") — nunca batiam. O mapper foi corrigido para gravar
 * a tag daqui pra frente; este script corrige o histórico já gravado.
 *
 * Fonte da tag: MarketplaceModel.tag, resolvido por Order.marketplaceId (sem chamada externa).
 *
 * Segurança:
 *   - DRY-RUN por padrão: lista quantos seriam corrigidos + amostra (antes/depois), SEM gravar.
 *   - Só grava com a flag --apply.
 *
 * Uso (a partir de backend/):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-order-marketplace-tag.ts            # dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-order-marketplace-tag.ts --apply     # grava
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppModule } from '../src/app.module';
import { OrderModel } from '../src/order/schemas/order.schema';
import { MarketplaceModel } from '../src/marketplace/schemas/marketplace.schema';

const APPLY = process.argv.includes('--apply');

async function main() {
  process.env.RECONCILER_ENABLED = 'false';
  const log = new Logger('BackfillOrderMarketplaceTag');

  log.log('🔌 Subindo AppModule e conectando ao banco…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const orderModel = app.get<Model<any>>(getModelToken(OrderModel.name));
  const marketplaceModel = app.get<Model<any>>(getModelToken(MarketplaceModel.name));

  const marketplaces = await marketplaceModel.find().select('_id name tag').lean().exec();
  const tagByMarketplaceId = new Map<string, string>();
  const nameByMarketplaceId = new Map<string, string>();
  for (const mp of marketplaces) {
    if (!mp.tag) continue;
    tagByMarketplaceId.set(String(mp._id), mp.tag);
    nameByMarketplaceId.set(String(mp._id), mp.name);
  }

  const orders = await orderModel
    .find({ marketplaceTag: { $exists: true, $ne: null } })
    .select('_id externalId marketplaceId marketplaceTag')
    .lean()
    .exec();

  let toFix = 0;
  let alreadyCorrect = 0;
  let unresolvedMarketplace = 0;
  let updated = 0;
  const samples: string[] = [];

  for (const o of orders) {
    const marketplaceId = String(o.marketplaceId);
    const expectedTag = tagByMarketplaceId.get(marketplaceId);
    const expectedName = nameByMarketplaceId.get(marketplaceId);

    if (!expectedTag) {
      unresolvedMarketplace++;
      continue;
    }

    if (o.marketplaceTag === expectedTag) {
      alreadyCorrect++;
      continue;
    }

    // Só corrige quando o valor gravado bate com o NAME esperado — nunca sobrescreve um
    // valor já divergente por outro motivo (ex: dado legado de origem desconhecida).
    if (o.marketplaceTag !== expectedName) {
      log.warn(
        `   ⚠ ${o.externalId}: marketplaceTag='${o.marketplaceTag}' não bate nem com name ('${expectedName}') nem com tag ('${expectedTag}') — pulado por segurança.`,
      );
      continue;
    }

    toFix++;
    if (samples.length < 15) {
      samples.push(`    ${o.externalId}: '${o.marketplaceTag}' → '${expectedTag}'`);
    }

    if (APPLY) {
      await orderModel.updateOne({ _id: o._id }, { $set: { marketplaceTag: expectedTag } });
      updated++;
    }
  }

  log.log('═══════════════════════════ RESULTADO ═══════════════════════════');
  log.log(`Pedidos com marketplaceTag: ${orders.length}`);
  log.log(`Já corretos (tag):          ${alreadyCorrect}`);
  log.log(`A corrigir (name→tag):      ${toFix}`);
  log.log(`Marketplace não resolvido:  ${unresolvedMarketplace}`);
  if (samples.length) {
    log.log('Exemplos (antes → depois):');
    samples.forEach((s) => log.log(s));
  }
  if (APPLY) {
    log.log(`✅ marketplaceTag corrigido em ${updated} pedido(s).`);
  } else {
    log.warn(`🧪 DRY-RUN: nada foi escrito. Rode com --apply para gravar ${toFix} correção(ões).`);
  }
  log.log('──────────────────────────────────────────────────────────────────');

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Backfill falhou:', e);
  process.exit(1);
});
