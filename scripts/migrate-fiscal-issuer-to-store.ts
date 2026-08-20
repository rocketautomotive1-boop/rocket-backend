/**
 * MIGRAÇÃO: fiscal_issuers (singleton) → legal_entities + Store.fiscalChannels[]
 *
 * Contexto: fiscal_issuers misturava dados imutáveis da empresa (CNPJ/IE/certificado)
 * com configuração de série/contador/sellerId por marketplace (nfeSeries, seriesCounters,
 * marketplaceSellerIds) — remendo descrito em
 * docs/superpowers/specs/2026-08-19-store-fiscal-legalentity-design.md. Este script:
 *
 *   1. Copia o documento de fiscal_issuers (isActive:true) para legal_entities,
 *      preservando o mesmo _id (evita reescrever referências externas).
 *   2. Vincula toda Store ativa a essa LegalEntity (assume-se hoje uma empresa só).
 *   3. Popula Store.fiscalChannels[] a partir de marketplaceAccounts[] existentes:
 *        - series: nfeSeries global do issuer (default para todo canal)
 *        - counter: seriesCounters[String(series)] do issuer — PRESERVA a numeração em
 *          curso; nunca reinicia contador (reiniciar duplicaria numeração perante a SEFAZ)
 *        - marketplaceSellerId: marketplaceSellerIds[marketplaceTag] do issuer, se houver
 *   4. Backfill de FiscalDocument.storeId a partir de order.marketplaceTag/accountId.
 *
 * Segurança:
 *   - DRY-RUN por padrão: loga o que mudaria, SEM gravar.
 *   - Só grava com a flag --apply.
 *   - Idempotente: pula Store cujo fiscalChannels já tenha entrada para o par
 *     (marketplaceTag, accountId); pula FiscalDocument que já tenha storeId.
 *
 * Uso (a partir de backend/):
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-fiscal-issuer-to-store.ts            # dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-fiscal-issuer-to-store.ts --apply     # grava
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { AppModule } from '../src/app.module';
import { StoreModel } from '../src/store/schemas/store.schema';
import { LegalEntityModel } from '../src/legal-entity/schemas/legal-entity.schema';
import { FiscalDocumentModel } from '../src/fiscal/schemas/fiscal.schema';

const APPLY = process.argv.includes('--apply');

async function main() {
  const log = new Logger('MigrateFiscalIssuerToStore');

  log.log('🔌 Subindo AppModule e conectando ao banco…');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const connection = app.get<Connection>(getConnectionToken());
  const storeModel = app.get<Model<any>>(getModelToken(StoreModel.name));
  const legalEntityModel = app.get<Model<any>>(getModelToken(LegalEntityModel.name));
  const fiscalDocumentModel = app.get<Model<any>>(getModelToken(FiscalDocumentModel.name));

  log.log(`${APPLY ? '✍️  APPLY' : '🧪 DRY-RUN'}`);

  // ── Step 1: fiscal_issuers → legal_entities ────────────────────────────
  // fiscal_issuers não tem mais Model registrado (schema removido) — lê via coleção nativa.
  const issuer = await connection.collection('fiscal_issuers').findOne({ isActive: true });
  if (!issuer) {
    log.warn('Nenhum fiscal_issuer ativo encontrado — nada a migrar. Encerrando.');
    await app.close();
    process.exit(0);
  }

  const legalEntityId = issuer._id as Types.ObjectId;
  const existingLegalEntity = await legalEntityModel.findById(legalEntityId).lean().exec();

  const legalEntityData = {
    _id: legalEntityId,
    cnpj: issuer.cnpj,
    ie: issuer.ie,
    companyName: issuer.companyName,
    fantasyName: issuer.fantasyName,
    taxRegime: issuer.taxRegime,
    email: issuer.email,
    responsibleContact: issuer.responsibleContact,
    phone: issuer.phone,
    certificatePfx: issuer.certificatePfx,
    certificatePassword: issuer.certificatePassword,
    address: issuer.address,
    isActive: issuer.isActive,
    difalExempt: issuer.difalExempt,
    effectiveTaxRate: issuer.effectiveTaxRate,
  };

  if (existingLegalEntity) {
    log.log(`legal_entities/${legalEntityId} já existe — pulando criação (idempotente).`);
  } else {
    log.log(`legal_entities/${legalEntityId} será criada a partir de fiscal_issuers/${legalEntityId} (${issuer.companyName}).`);
    if (APPLY) {
      await legalEntityModel.create(legalEntityData);
      log.log('  ✅ LegalEntity criada.');
    }
  }

  const globalSeries = Number(issuer.nfeSeries || 1);
  const seriesCounters: Record<string, number> = issuer.seriesCounters instanceof Map
    ? Object.fromEntries(issuer.seriesCounters)
    : (issuer.seriesCounters || {});
  const marketplaceSellerIds: Record<string, string> = issuer.marketplaceSellerIds || {};

  log.log(`Série global do issuer: ${globalSeries}. Contadores existentes: ${JSON.stringify(seriesCounters)}.`);

  // ── Step 2 & 3: Store.legalEntityId + Store.fiscalChannels[] ───────────
  const stores = await storeModel.find().lean().exec();
  log.log(`${stores.length} loja(s) encontrada(s).`);

  let storesLinked = 0;
  let channelsCreated = 0;
  let channelsSkipped = 0;

  for (const store of stores) {
    const updates: Record<string, any> = {};

    if (!store.legalEntityId) {
      updates.legalEntityId = legalEntityId;
      storesLinked++;
    }

    const existingChannels: any[] = store.fiscalChannels ?? [];
    const newChannels: any[] = [];

    for (const acc of store.marketplaceAccounts ?? []) {
      const already = existingChannels.some(
        (c) => c.marketplaceTag === acc.marketplaceTag && c.accountId === acc.accountId,
      );
      if (already) {
        channelsSkipped++;
        continue;
      }
      // Marketplace settings.nfeSeries (override por tag) não é lido aqui via model
      // (MarketplaceConfigCacheService exigiria bootstrap completo) — usa-se a série
      // global do issuer como default; overrides específicos por marketplace, se
      // existiam, devem ser conferidos manualmente pós-migração (log abaixo).
      const series = globalSeries;
      const counter = seriesCounters[String(series)] ?? 0;
      const marketplaceSellerId = marketplaceSellerIds[acc.marketplaceTag] || undefined;

      newChannels.push({
        marketplaceTag: acc.marketplaceTag,
        accountId: acc.accountId,
        series,
        counter,
        marketplaceSellerId,
      });
      channelsCreated++;
      log.log(
        `  loja "${store.name}" ← canal ${acc.marketplaceTag}/${acc.accountId}: série=${series} contador=${counter}` +
          (marketplaceSellerId ? ` sellerId=${marketplaceSellerId}` : ''),
      );
    }

    if (newChannels.length) {
      updates.fiscalChannels = [...existingChannels, ...newChannels];
    }

    if (Object.keys(updates).length && APPLY) {
      await storeModel.updateOne({ _id: store._id }, { $set: updates }).exec();
    }
  }

  // ── Step 4: FiscalDocument.storeId backfill ─────────────────────────────
  const orderModel = connection.collection('orders');
  const docsWithoutStore = await fiscalDocumentModel
    .find({ storeId: { $exists: false } })
    .select('_id order orderId')
    .lean()
    .exec();

  log.log(`${docsWithoutStore.length} fiscal_document(s) sem storeId.`);

  // Reconstrói o mapa (marketplaceTag,accountId) → storeId a partir do estado pós-migração.
  const freshStores = APPLY ? await storeModel.find().lean().exec() : stores.map((s: any) => ({
    ...s,
    fiscalChannels: [...(s.fiscalChannels ?? [])],
  }));
  const storeIdByAccountKey = new Map<string, Types.ObjectId>();
  for (const s of freshStores) {
    for (const acc of s.marketplaceAccounts ?? []) {
      storeIdByAccountKey.set(`${acc.marketplaceTag}:${acc.accountId}`, s._id);
    }
  }

  let fiscalDocsLinked = 0;
  let fiscalDocsUnresolved = 0;
  for (const doc of docsWithoutStore) {
    const orderId = doc.order || doc.orderId;
    if (!orderId) {
      fiscalDocsUnresolved++;
      continue; // emissão avulsa histórica sem Order — fica sem storeId (aceitável, é histórico)
    }
    const order = await orderModel.findOne({ _id: orderId }, { projection: { marketplaceTag: 1, accountId: 1 } });
    if (!order?.marketplaceTag || !order?.accountId) {
      fiscalDocsUnresolved++;
      continue;
    }
    const storeId = storeIdByAccountKey.get(`${order.marketplaceTag}:${order.accountId}`);
    if (!storeId) {
      fiscalDocsUnresolved++;
      continue;
    }
    fiscalDocsLinked++;
    if (APPLY) {
      await fiscalDocumentModel.updateOne({ _id: doc._id }, { $set: { storeId } }).exec();
    }
  }

  log.log('═══════════════════════════ RESULTADO ═══════════════════════════');
  log.log(`LegalEntity: ${existingLegalEntity ? 'já existia' : (APPLY ? 'criada' : 'seria criada')}`);
  log.log(`Lojas vinculadas à LegalEntity: ${storesLinked}`);
  log.log(`Canais fiscais criados: ${channelsCreated} (pulados por já existir: ${channelsSkipped})`);
  log.log(`FiscalDocuments vinculados a Store: ${fiscalDocsLinked} (não resolvidos: ${fiscalDocsUnresolved})`);
  if (!APPLY) {
    log.warn('🧪 DRY-RUN: nada foi escrito. Rode com --apply para gravar.');
  } else {
    log.log('✅ Migração aplicada.');
    log.warn(
      '⚠️  Confira manualmente se algum marketplace tinha settings.nfeSeries != série global — ' +
        'esses canais foram migrados com a série global do issuer e podem precisar de ajuste via ' +
        'PUT /stores/:storeId/fiscal-channels/:marketplaceTag/:accountId.',
    );
  }
  log.log('──────────────────────────────────────────────────────────────────');

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Migração falhou:', e);
  process.exit(1);
});
