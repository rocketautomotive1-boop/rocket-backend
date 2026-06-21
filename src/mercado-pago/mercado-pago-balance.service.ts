import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MercadoPagoClient } from './mercado-pago.client';
import {
  MpBalanceSnapshotModel,
  MpBalanceSnapshotDocument,
} from './schemas/mp-balance-snapshot.schema';

export interface MercadoPagoBalance {
  /** Saldo disponível (R$). Vem do cache do release_report. */
  available: number;
  /** Saldo a liberar (R$). Calculado ao vivo via payments pendentes. */
  pending: number;
  /** available + pending. */
  total: number;
  /** Quando o saldo disponível foi capturado (null se nunca rodou o job). */
  availableCapturedAt: Date | null;
}

const REPORT_WINDOW_DAYS = 30;
const REPORT_POLL_ATTEMPTS = 12;
const REPORT_POLL_INTERVAL_MS = 5_000;
const PAYMENTS_PAGE_SIZE = 50;
/** Trava de segurança contra contas com histórico enorme (~16 páginas p/ ~784 pgtos). */
const PAYMENTS_MAX_PAGES = 40;

/**
 * Saldo do Mercado Pago — service dedicado e desacoplado (não conhece WhatsApp).
 *
 * Dois componentes (confirmados contra o painel MP):
 * - DISPONÍVEL ("Saldo"): só obtível via release_report (assíncrono). `refreshAvailable()`
 *   gera o report, baixa o CSV e extrai BALANCE_AMOUNT da última linha de movimento.
 *   O valor fica em cache (MpBalanceSnapshot); `getBalance()` lê o cache (rápido).
 * - A LIBERAR ("Liberações"): soma de net_received_amount dos pagamentos aprovados
 *   com money_release_status='pending'. Síncrono via payments/search.
 *
 * Somar payments 'released' NÃO dá o disponível (ignora saques/transferências) — por
 * isso o disponível depende do extrato (release_report), única fonte que contabiliza saques.
 */
@Injectable()
export class MercadoPagoBalanceService {
  private readonly logger = new Logger(MercadoPagoBalanceService.name);

  constructor(
    private readonly client: MercadoPagoClient,
    @InjectModel(MpBalanceSnapshotModel.name)
    private readonly snapshotModel: Model<MpBalanceSnapshotDocument>,
  ) {}

  /** Saldo consolidado: disponível (cache) + a liberar (ao vivo). */
  async getBalance(): Promise<MercadoPagoBalance> {
    const [snapshot, pending] = await Promise.all([
      this.snapshotModel.findOne().sort({ capturedAt: -1 }).lean().exec(),
      this.fetchPending(),
    ]);

    const available = snapshot?.available ?? 0;
    return {
      available,
      pending,
      total: available + pending,
      availableCapturedAt: snapshot?.capturedAt ?? null,
    };
  }

  /**
   * Gera o release_report, baixa o CSV e grava o saldo disponível no cache.
   * Chamado pelo job periódico. Retorna o valor capturado.
   */
  async refreshAvailable(): Promise<number> {
    const accountId = await this.client.getAccountId();

    const now = new Date();
    const begin = new Date(now.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Dispara a geração de um report fresco (best-effort, para a próxima rodada).
    // O report do MP é assíncrono e pode levar minutos — não bloqueamos esperando
    // ele especificamente. Lemos o report `enabled` MAIS RECENTE disponível agora;
    // se for o que acabamos de gerar, ótimo; senão, o anterior já é recente o
    // bastante (o job roda a cada 30min).
    try {
      await this.client.generateReleaseReport(begin, now);
    } catch (err) {
      this.logger.warn(`generateReleaseReport falhou (seguindo com report existente): ${(err as Error).message}`);
    }

    const fileName = await this.waitForLatestReport();
    if (!fileName) {
      throw new Error('Nenhum release_report disponível (lista vazia após polling).');
    }

    const csv = await this.client.downloadReleaseReport(fileName);
    const available = this.parseAvailableFromCsv(csv);

    await this.snapshotModel.updateOne(
      { accountId },
      { $set: { accountId, available, capturedAt: new Date() } },
      { upsert: true },
    );

    this.logger.log(`Saldo disponível MP atualizado: R$ ${available.toFixed(2)} (conta ${accountId}).`);
    return available;
  }

  /** Soma o saldo a liberar: net_received dos pagamentos com release pendente. */
  async fetchPending(): Promise<number> {
    let pending = 0;
    let offset = 0;
    let total = Infinity;

    for (let page = 0; page < PAYMENTS_MAX_PAGES && offset < total; page++) {
      const data = await this.client.searchApprovedPayments(offset, PAYMENTS_PAGE_SIZE);
      total = data.paging?.total ?? 0;
      const results = data.results ?? [];
      if (results.length === 0) break;

      for (const p of results) {
        if (p.money_release_status === 'pending') {
          pending += p.transaction_details?.net_received_amount ?? 0;
        }
      }
      offset += PAYMENTS_PAGE_SIZE;
    }

    return Number(pending.toFixed(2));
  }

  /**
   * Retorna o file_name do report `enabled` mais recente. Se a lista já tem um
   * report pronto, retorna na hora; senão faz polling curto (caso seja a primeira
   * geração e a lista esteja vazia).
   */
  private async waitForLatestReport(): Promise<string | null> {
    for (let attempt = 0; attempt < REPORT_POLL_ATTEMPTS; attempt++) {
      const reports = await this.client.listReleaseReports();
      const ready = reports
        .filter((r) => r.status === 'enabled')
        .sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created));
      if (ready.length > 0) return ready[0].file_name;
      await this.sleep(REPORT_POLL_INTERVAL_MS);
    }
    return null;
  }

  /**
   * Extrai o saldo disponível do CSV do release_report.
   *
   * Formato (separador `;`): header + linhas de movimento + linha de rodapé (totais).
   * A coluna BALANCE_AMOUNT é o saldo acumulado (running). O saldo atual é o
   * BALANCE_AMOUNT da ÚLTIMA linha de movimento — o rodapé traz BALANCE_AMOUNT=0,
   * então é descartado.
   */
  private parseAvailableFromCsv(csv: string): number {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return 0;

    const header = lines[0].split(';').map((h) => h.trim());
    const balanceIdx = header.indexOf('BALANCE_AMOUNT');
    const dateIdx = header.indexOf('DATE');
    if (balanceIdx === -1) {
      throw new Error('Coluna BALANCE_AMOUNT ausente no CSV do release_report.');
    }

    // Última linha que tem DATE preenchido = última movimentação (ignora rodapé de totais).
    for (let i = lines.length - 1; i >= 1; i--) {
      const cols = lines[i].split(';');
      const hasDate = dateIdx === -1 ? true : (cols[dateIdx] ?? '').trim().length > 0;
      const raw = (cols[balanceIdx] ?? '').trim();
      if (hasDate && raw.length > 0) {
        const value = Number(raw);
        if (!Number.isNaN(value)) return value;
      }
    }
    return 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
