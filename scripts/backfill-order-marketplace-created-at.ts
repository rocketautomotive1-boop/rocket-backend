/**
 * BACKFILL de `marketplaceCreatedAt` nos pedidos já gravados.
 *
 * Contexto: até agora o pedido só guardava `createdAt` (timestamps = momento da NOSSA
 * ingestão). A data real da venda no marketplace (ML `date_created`) não era persistida,
 * então pedidos ingeridos hoje (ex.: via reconcile) ficavam todos "de hoje". Agora o
 * schema tem `marketplaceCreatedAt` e o mapper o preenche — este script corrige o histórico.
 *
 * Fonte da data real: RE-BUSCA na API do marketplace (gateway.fetchOrder → date_created),
 * o mesmo caminho de 1ª classe usado pela ingestão/reconcile. Token/conta resolvidos pela
 * infra existente (nada de auth reimplementada aqui).
 *
 * Segurança:
 *   - DRY-RUN por padrão: lista quantos seriam corrigidos + exemplos (antes/depois), SEM gravar.
 *   - Só grava com a flag --apply.
 *   - Escopo padrão: apenas pedidos SEM marketplaceCreatedAt ingeridos HOJE (createdAt >= 00:00).
 *     Use --all para varrer todo o histórico sem a data.
 *
 * Uso (a partir de backend/):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-order-marketplace-created-at.ts            # dry-run, só de hoje
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-order-marketplace-created-at.ts --apply    # grava, só de hoje
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-order-marketplace-created-at.ts --all       # dry-run, histórico todo
 *   ... --all --apply                                                                                    # grava histórico todo
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppModule } from '../src/app.module';
import {
  MARKETPLACE_ORDER_GATEWAY,
  MarketplaceOrderGateway,
} from '../src/order/ports/marketplace-order.gateway';
import { OrderModel } from '../src/order/schemas/order.schema';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

function startOfTodayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function main() {
  process.env.RECONCILER_ENABLED = 'false'; // não arma timers de fundo
  const log = new Logger('BackfillMarketplaceCreatedAt');

  log.log('🔌 Subindo AppModule e conectando ao banco…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const gateway = app.get<MarketplaceOrderGateway>(MARKETPLACE_ORDER_GATEWAY);
  const orderModel = app.get<Model<any>>(getModelToken(OrderModel.name));

  const filter: Record<string, any> = {
    $or: [{ marketplaceCreatedAt: { $exists: false } }, { marketplaceCreatedAt: null }],
  };
  if (!ALL) {
    filter.createdAt = { $gte: startOfTodayLocal() };
  }

  const orders = await orderModel
    .find(filter)
    .select('_id externalId marketplaceId accountId createdAt')
    .lean()
    .exec();

  log.log(
    `${APPLY ? '✍️  APPLY' : '🧪 DRY-RUN'} · escopo=${ALL ? 'histórico completo' : 'somente de hoje'} · ` +
      `${orders.length} pedido(s) sem marketplaceCreatedAt`,
  );
  if (!orders.length) {
    log.log('Nada a corrigir.');
    await app.close();
    process.exit(0);
  }

  let resolved = 0;
  let notFound = 0;
  let failed = 0;
  let updated = 0;
  const samples: string[] = [];

  for (const o of orders) {
    const externalId = String(o.externalId);
    const marketplaceId = String(o.marketplaceId);
    const accountId = o.accountId ? String(o.accountId) : undefined;

    let dateCreated: string | undefined;
    try {
      const ext = await gateway.fetchOrder(externalId, marketplaceId, accountId);
      dateCreated = ext?.date_created;
    } catch (e) {
      failed++;
      log.warn(`   ✖ ${externalId}: falha ao buscar no marketplace — ${(e as Error).message}`);
      continue;
    }

    if (!dateCreated) {
      notFound++;
      log.warn(`   • ${externalId}: marketplace não retornou date_created (pulado).`);
      continue;
    }

    const realDate = new Date(dateCreated);
    resolved++;

    if (samples.length < 10) {
      samples.push(
        `    ${externalId}: ingestão=${new Date(o.createdAt).toISOString()} → real=${realDate.toISOString()}`,
      );
    }

    if (APPLY) {
      await orderModel.updateOne({ _id: o._id }, { $set: { marketplaceCreatedAt: realDate } });
      updated++;
    }
  }

  log.log('═══════════════════════════ RESULTADO ═══════════════════════════');
  log.log(`Pedidos analisados:        ${orders.length}`);
  log.log(`Data real resolvida (ML):  ${resolved}`);
  log.log(`Sem date_created/404:      ${notFound}`);
  log.log(`Falhas de API:             ${failed}`);
  if (samples.length) {
    log.log('Exemplos (antes → depois):');
    samples.forEach((s) => log.log(s));
  }
  if (APPLY) {
    log.log(`✅ marketplaceCreatedAt gravado em ${updated} pedido(s).`);
  } else {
    log.warn(`🧪 DRY-RUN: nada foi escrito. Rode com --apply para gravar ${resolved} correção(ões).`);
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
