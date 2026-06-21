/**
 * TESTE do OrderReconciler contra o Atlas REAL. Dois modos:
 *
 *  (A) READ-ONLY (default) — reproduz a lógica de detecção do OrderReconciler.runFor():
 *        cursor (checkpoint) → gateway.listOrdersSince(cursor) [API REAL do marketplace]
 *        → para cada ref: existing = repo.findStatusByExternalId(ref.id)
 *          gap se !existing || isStatusDivergent(existing.status, ref.status)
 *      NÃO chama ingest(): nenhuma escrita.
 *
 *  (B) ESCRITA (DRYRUN_INGEST=<extId>) — concilia DE VERDADE um único pedido conhecido,
 *      pelo MESMO caminho de 1ª classe que o endpoint POST /orders/syncc usa:
 *      OrderIngestService.ingest(extId, mkt, 'manual'). Mostra o doc antes/depois.
 *
 * Boot: AppModule completo (única forma em que o grafo de DI resolve — MarketplaceModule
 * não é autossuficiente isolado). Schedulers de boot (ex.: TokenRefreshScheduler agenda
 * timers de refresh) ficam registrados, mas o script chama app.close()/process.exit()
 * assim que termina — não fica vivo esperando timer algum.
 *
 * Uso (a partir de backend/):
 *   npx ts-node -r tsconfig-paths/register scripts/reconcile-dry-run.ts
 *   DRYRUN_INGEST=<extId> DRYRUN_MARKETPLACE=<mktId> [DRYRUN_ACCOUNT=<id>] npx ts-node ... reconcile-dry-run.ts
 *
 * Flags (env): DRYRUN_MARKETPLACE, DRYRUN_ACCOUNT, DRYRUN_INGEST, DRYRUN_LIMIT (default 50)
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
import { OrderRepository } from '../src/order/order.repository';
import { OrderIngestService } from '../src/order/ingest/order-ingest.service';
import { MarketplaceRegistryService } from '../src/marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../src/marketplace/auth/services/marketplace-token-broker.service';
import {
  ReconcileCheckpointModel,
  ReconcileCheckpointDocument,
} from '../src/order/reconcile/reconcile-checkpoint.schema';
import { RECONCILE, isStatusDivergent } from '../src/order/reconcile/reconcile-cursor';

async function main() {
  process.env.RECONCILER_ENABLED = 'false'; // não arma os timers do próprio reconciler

  const log = new Logger('ReconcileDryRun');
  const limit = Number(process.env.DRYRUN_LIMIT ?? 50);
  const onlyMkt = process.env.DRYRUN_MARKETPLACE;
  const ingestId = process.env.DRYRUN_INGEST;
  const ingestAccount = process.env.DRYRUN_ACCOUNT;

  log.log('🔌 Subindo AppModule e conectando ao Atlas…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const gateway = app.get<MarketplaceOrderGateway>(MARKETPLACE_ORDER_GATEWAY);
  const repo = app.get(OrderRepository);
  const registry = app.get(MarketplaceRegistryService);
  const broker = app.get(MarketplaceTokenBrokerService);
  const checkpoints = app.get<Model<ReconcileCheckpointDocument>>(
    getModelToken(ReconcileCheckpointModel.name),
  );

  // ── MODO B: conciliar de verdade UM pedido conhecido (caminho 'manual') ───
  if (ingestId) {
    if (!onlyMkt) {
      log.error('DRYRUN_INGEST exige DRYRUN_MARKETPLACE=<marketplaceId>.');
      await app.close();
      process.exit(1);
    }
    log.warn(`⚠️  ESCRITA: conciliando pedido ${ingestId} (mkt=${onlyMkt}${ingestAccount ? ` conta=${ingestAccount}` : ''})…`);

    const before = await repo.findByExternalId(ingestId);
    log.log(`Antes:  ${before ? `status=${before.status} logistics=${before.logisticsStatus}` : '(não existe localmente)'}`);

    await app.get(OrderIngestService).ingest(ingestId, onlyMkt, 'manual', ingestAccount);

    const after = await repo.findByExternalId(ingestId);
    if (!after) {
      log.error(`Depois: ${ingestId} AINDA não existe — provável não encontrado na API do marketplace.`);
    } else {
      log.log('Depois (CONCILIADO):');
      log.log(`  externalId=${after.externalId} status=${after.status} logistics=${after.logisticsStatus}`);
      log.log(`  totalAmount=${after.totalAmount} itens=${after.items?.length ?? 0} detectedBy=${(after as any).reconcile?.detectedBy ?? '—'}`);
    }
    await app.close();
    process.exit(0);
  }

  // ── MODO A: detectar gaps (read-only) ─────────────────────────────────────
  const marketplaces = (await registry.findAll()).filter((m: any) => m.enabled);
  log.log(`Marketplaces habilitados: ${marketplaces.map((m: any) => m.name).join(', ') || '(nenhum)'}`);

  const report: Array<{
    marketplace: string;
    accountId: string | null;
    cursor: string;
    deltaCount: number;
    gaps: Array<{ id: string; mlStatus: string; localStatus: string | null; reason: string }>;
  }> = [];

  for (const mkt of marketplaces) {
    const marketplaceId = String(mkt._id);
    if (onlyMkt && marketplaceId !== onlyMkt) continue;

    const accounts = await broker.listAccountsWithToken(marketplaceId);
    const targets = accounts.length ? accounts.map((a: any) => a.accountId) : [undefined];

    for (const accountId of targets) {
      const filter = { marketplaceId, accountId: accountId ?? null };
      const cp = await checkpoints.findOne(filter).lean();
      const cursor = cp?.lastUpdatedCursor
        ? new Date(cp.lastUpdatedCursor)
        : new Date(Date.now() - RECONCILE.BOOTSTRAP_WINDOW_MS);

      log.log(
        `→ ${mkt.name}${accountId ? ` [conta ${accountId}]` : ''} cursor=${cursor.toISOString()}` +
          (cp ? '' : ' (sem checkpoint → janela bootstrap 7d)'),
      );

      let refs: any[] = [];
      try {
        refs = await gateway.listOrdersSince(marketplaceId, cursor, accountId); // READ-ONLY na API
      } catch (e) {
        log.error(`   ✖ falha ao listar pedidos: ${(e as Error).message}`);
        report.push({ marketplace: mkt.name, accountId: accountId ?? null, cursor: cursor.toISOString(), deltaCount: -1, gaps: [] });
        continue;
      }

      const gaps: Array<{ id: string; mlStatus: string; localStatus: string | null; reason: string }> = [];
      for (const ref of refs) {
        const existing = await repo.findStatusByExternalId(ref.id); // READ-ONLY (.lean)
        if (!existing) {
          gaps.push({ id: ref.id, mlStatus: ref.status, localStatus: null, reason: 'MISSING_LOCALLY' });
        } else if (isStatusDivergent(existing.status, ref.status)) {
          gaps.push({ id: ref.id, mlStatus: ref.status, localStatus: existing.status, reason: 'STATUS_DIVERGENT' });
        }
      }

      log.log(
        `   delta=${refs.length} gaps=${gaps.length}` +
          (gaps.length ? ` → o reconciler INGERIRIA ${gaps.length} pedido(s)` : ' → run LIMPO'),
      );
      report.push({
        marketplace: mkt.name,
        accountId: accountId ?? null,
        cursor: cursor.toISOString(),
        deltaCount: refs.length,
        gaps: gaps.slice(0, limit),
      });
    }
  }

  log.log('═══════════════════════════ RELATÓRIO (DRY-RUN) ═══════════════════════════');
  let totalGaps = 0;
  for (const r of report) {
    const head = `${r.marketplace}${r.accountId ? ` [${r.accountId}]` : ''}`;
    if (r.deltaCount < 0) {
      log.error(`${head}: ERRO ao consultar marketplace`);
      continue;
    }
    totalGaps += r.gaps.length;
    log.log(`${head}: delta=${r.deltaCount}, gaps=${r.gaps.length} (cursor ${r.cursor})`);
    for (const g of r.gaps) {
      log.log(`    • ${g.id}  ml=${g.mlStatus}  local=${g.localStatus ?? '—'}  [${g.reason}]`);
    }
  }
  log.log('───────────────────────────────────────────────────────────────────────────');
  log.log(`TOTAL de pedidos que o reconciler conciliaria agora: ${totalGaps}`);
  log.warn('Nada foi escrito (modo read-only).');

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('DRY-RUN falhou:', e);
  process.exit(1);
});
