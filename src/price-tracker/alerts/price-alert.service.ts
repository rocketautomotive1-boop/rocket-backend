import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import { NotificationRequested } from '../../notifications/contracts/notification-requested.event';
import { PriceAlertModel } from '../schemas/price-alert.schema';
import { TrackedItemModel } from '../schemas/tracked-item.schema';
import { PriceHistoryBestOffer } from '../schemas/price-history.schema';
import {
  AlertReason, PriceAnalysis, evaluateTriggers, shouldRealert,
} from '../analysis/price-analysis';

export interface TrackedItemLean {
  _id: Types.ObjectId;
  ean: string;
  name: string;
  targetPrice?: number | null;
  discountThresholdPct: number;
  inDealSince?: Date | null;
  lastAlertPrice?: number | null;
}

const fmtBRL = (v: number) =>
  `R$ ${v.toFixed(2).replace('.', ',')}`;

/**
 * Máquina de estado do alerta (detector, não executor): avalia gatilhos, aplica
 * cooldown via inDealSince/lastAlertPrice, persiste price_alert e emite a
 * notificação pelo pipeline existente (push + websocket + persist).
 */
@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name);

  constructor(
    @InjectModel(PriceAlertModel.name) private readonly alertModel: Model<PriceAlertModel>,
    @InjectModel(TrackedItemModel.name) private readonly itemModel: Model<TrackedItemModel>,
    private readonly emitter: EventEmitter2,
  ) {}

  async processSnapshot(
    item: TrackedItemLean,
    current: number,
    currentCount: number,
    analysis: PriceAnalysis,
    bestOffer: PriceHistoryBestOffer | null,
  ): Promise<AlertReason | null> {
    const reason = evaluateTriggers({
      current,
      currentCount,
      analysis,
      targetPrice: item.targetPrice,
      thresholdPct: item.discountThresholdPct,
    });

    if (!reason) {
      // Saiu da oferta → limpa o estado; próxima entrada alerta normalmente.
      if (item.inDealSince) {
        await this.itemModel.updateOne({ _id: item._id }, { $set: { inDealSince: null } }).exec();
      }
      return null;
    }

    const entering = !item.inDealSince;
    if (!entering && item.lastAlertPrice != null && !shouldRealert(item.lastAlertPrice, current)) {
      return null; // cooldown: em oferta contínua, só re-alerta com queda extra de 5%
    }

    const now = new Date();
    await this.alertModel.create({
      itemId: item._id,
      ean: item.ean,
      triggeredAt: now,
      reason,
      currentPrice: current,
      movingAvg: analysis.movingAvg,
      targetPrice: item.targetPrice ?? null,
      bestOffer,
    });

    await this.itemModel.updateOne(
      { _id: item._id },
      {
        $set: {
          inDealSince: entering ? now : item.inDealSince,
          lastAlertAt: now,
          lastAlertPrice: current,
        },
      },
    ).exec();

    this.emit(item, reason, current, analysis, bestOffer, now);
    this.logger.log(`Alerta ${reason} ean=${item.ean} preço=${current}`);
    return reason;
  }

  private emit(
    item: TrackedItemLean,
    reason: AlertReason,
    current: number,
    analysis: PriceAnalysis,
    bestOffer: PriceHistoryBestOffer | null,
    now: Date,
  ): void {
    const pct =
      analysis.movingAvg && analysis.movingAvg > 0
        ? Math.round((1 - current / analysis.movingAvg) * 100)
        : null;

    const reasonLabel: Record<AlertReason, string> = {
      below_target: 'abaixo do seu preço-alvo',
      all_time_low: 'menor preço já registrado',
      below_moving_avg: pct != null ? `−${pct}% vs média 14d` : 'abaixo da média',
    };

    const where = bestOffer?.sellerName
      ? `${bestOffer.sellerName}${bestOffer.bairro ? ` (${bestOffer.bairro})` : ''}`
      : 'estabelecimento não informado';

    const req: NotificationRequested = {
      type: `price-tracker.deal.${reason}`,
      aggregateType: 'price-tracker',
      aggregateId: String(item._id),
      title: `🔥 ${item.name}: ${fmtBRL(current)}`,
      body: `${reasonLabel[reason]} — ${where}`,
      severity: 'info',
      deduplicationKey: `price-tracker:${item._id}:${now.toISOString().slice(0, 10)}`,
      data: {
        ean: item.ean,
        currentPrice: current,
        movingAvg: analysis.movingAvg,
        reason,
        actionRoute: `/(drawer)/price-tracker/${item._id}`,
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }
}
