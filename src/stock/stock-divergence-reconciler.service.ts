import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StoreListingStockMovementModel, StoreListingStockMovementDocument } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceDocument } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { computeDivergences, StockDivergence } from './domain/divergence.calculator';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';

const ALERT_SAMPLE_SIZE = 20;

/**
 * Rede de segurança que o StockReconcilerService legado dava (cron diário comparando ledger x
 * saldo materializado) e que ficou sem substituto quando o legado foi removido (Contract
 * completo, 2026-08-29 — ver docs/superpowers/specs/2026-08-29-stock-divergence-reconciler-design.md).
 * Só detecta e alerta — nunca corrige: diferente do legado, correção exige decisão humana.
 *
 * Lê movementModel/balanceModel via @InjectModel direto (não StoreListingPort/StockQueryPort)
 * de propósito: precisa da coleção INTEIRA para comparar ledger x saldo materializado — os ports
 * existem para consultas por produto/loja, não para full-scan de auditoria. Interno ao módulo,
 * então não quebra a fronteira de porta que os consumidores externos (Product/Order/Marketplace)
 * respeitam.
 */
@Injectable()
export class StockDivergenceReconcilerService {
  private readonly logger = new Logger(StockDivergenceReconcilerService.name);
  private running = false;

  constructor(
    @InjectModel(StoreListingStockMovementModel.name)
    private readonly movementModel: Model<StoreListingStockMovementDocument>,
    @InjectModel(StoreListingStockBalanceModel.name)
    private readonly balanceModel: Model<StoreListingStockBalanceDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduled(): Promise<StockDivergence[]> {
    return this.run();
  }

  async run(): Promise<StockDivergence[]> {
    if (this.running) {
      this.logger.warn('[StockDivergence] varredura já em andamento — pulando execução concorrente');
      return [];
    }
    this.running = true;
    try {
      const [movements, balances] = await Promise.all([
        this.movementModel.find({}, { storeListingId: 1, condition: 1, type: 1, quantity: 1 }).lean().exec(),
        this.balanceModel.find({}, { storeListingId: 1, condition: 1, onHand: 1 }).lean().exec(),
      ]);

      const divergences = computeDivergences(
        movements.map((m: any) => ({
          storeListingId: String(m.storeListingId),
          condition: m.condition ?? 'new',
          type: m.type,
          quantity: m.quantity,
        })),
        balances.map((b: any) => ({
          storeListingId: String(b.storeListingId),
          condition: b.condition,
          onHand: b.onHand,
        })),
      );

      if (divergences.length === 0) {
        this.logger.log('[StockDivergence] varredura concluída, nenhuma divergência encontrada');
        return [];
      }

      this.logger.error(`[StockDivergence] ${divergences.length} divergência(s) encontrada(s): ${JSON.stringify(divergences)}`);
      this.notify(divergences);
      return divergences;
    } finally {
      this.running = false;
    }
  }

  private notify(divergences: StockDivergence[]): void {
    const today = new Date().toISOString().slice(0, 10);
    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'stock.divergence.detected',
      aggregateType: 'stock',
      aggregateId: 'stock-divergence-reconciler',
      title: 'Divergência de estoque detectada',
      body: `${divergences.length} divergência(s) entre o ledger e o saldo materializado de estoque. Verifique o /stock/reconcile/run para detalhes.`,
      severity: 'error',
      source: 'reconciliation',
      deduplicationKey: `stock.divergence.detected:${today}`,
      audience: { kind: 'all-admins' },
      data: { count: divergences.length, sample: divergences.slice(0, ALERT_SAMPLE_SIZE) },
    });
  }
}
