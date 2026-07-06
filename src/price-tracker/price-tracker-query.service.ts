import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TrackedItemModel } from './schemas/tracked-item.schema';
import { PriceHistoryModel } from './schemas/price-history.schema';
import { PriceAlertModel } from './schemas/price-alert.schema';
import { CurrentOffersModel } from './schemas/current-offers.schema';
import { computeAnalysis, computeWindowLows, MOVING_AVG_DAYS, SnapshotPoint, WindowLows } from './analysis/price-analysis';

export interface TrackedItemView {
  id: string;
  ean: string;
  name: string;
  active: boolean;
  targetPrice: number | null;
  discountThresholdPct: number;
  isDeal: boolean;
  lastPrice: number | null;
  lastCount: number | null;
  lastScannedAt: Date | null;
  movingAvg: number | null;
  allTimeLow: number | null;
  pctVsAvg: number | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Leituras da API: lista com estado atual (1 aggregation, sem N+1), histórico e deals. */
@Injectable()
export class PriceTrackerQueryService {
  constructor(
    @InjectModel(TrackedItemModel.name) private readonly itemModel: Model<TrackedItemModel>,
    @InjectModel(PriceHistoryModel.name) private readonly historyModel: Model<PriceHistoryModel>,
    @InjectModel(PriceAlertModel.name) private readonly alertModel: Model<PriceAlertModel>,
    @InjectModel(CurrentOffersModel.name) private readonly currentOffersModel: Model<CurrentOffersModel>,
  ) {}

  async listItems(): Promise<TrackedItemView[]> {
    const items = await this.itemModel.find().sort({ createdAt: -1 }).lean().exec();
    if (!items.length) return [];

    const cutoff = new Date(Date.now() - MOVING_AVG_DAYS * 86_400_000);
    // 1 aggregation p/ todos os EANs: último snapshot válido + all-time low + média 14d.
    const agg = await this.historyModel.aggregate([
      { $match: { ean: { $in: items.map((i) => i.ean) }, error: null, 'stats.min': { $ne: null } } },
      { $sort: { scannedAt: -1 } },
      {
        $group: {
          _id: '$ean',
          lastPrice: { $first: '$stats.min' },
          lastCount: { $first: '$stats.count' },
          lastScannedAt: { $first: '$scannedAt' },
          allTimeLow: { $min: '$stats.min' },
          // $avg ignora null → média apenas da janela de 14d.
          movingAvg: { $avg: { $cond: [{ $gte: ['$scannedAt', cutoff] }, '$stats.min', null] } },
        },
      },
    ]).exec();
    const byEan = new Map(agg.map((a: any) => [a._id, a]));

    return items.map((item: any) => {
      const s = byEan.get(item.ean);
      const movingAvg = s?.movingAvg != null ? Math.round(s.movingAvg * 100) / 100 : null;
      const pctVsAvg =
        s?.lastPrice != null && movingAvg
          ? round1(((s.lastPrice - movingAvg) / movingAvg) * 100)
          : null;
      return {
        id: String(item._id),
        ean: item.ean,
        // Nome ainda não preenchido pelo scan → mostra o EAN como fallback.
        name: item.name || `EAN ${item.ean}`,
        active: item.active,
        targetPrice: item.targetPrice ?? null,
        discountThresholdPct: item.discountThresholdPct,
        // isDeal = estado da máquina de alerta (consistente com o que notificou).
        isDeal: !!item.inDealSince,
        lastPrice: s?.lastPrice ?? null,
        lastCount: s?.lastCount ?? null,
        lastScannedAt: s?.lastScannedAt ?? null,
        movingAvg,
        allTimeLow: s?.allTimeLow ?? null,
        pctVsAvg,
      };
    });
  }

  async history(id: string, days: number) {
    const item = await this.itemModel.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Item monitorado não encontrado');

    const since = new Date(Date.now() - days * 86_400_000);
    const docs = await this.historyModel
      .find({ ean: (item as any).ean, scannedAt: { $gte: since } })
      .sort({ scannedAt: 1 })
      .lean()
      .exec();

    const points: SnapshotPoint[] = docs.map((h: any) => ({
      min: h.stats?.min ?? null,
      count: h.stats?.count ?? 0,
      scannedAt: new Date(h.scannedAt),
      error: h.error,
    }));
    const analysis = computeAnalysis(points, new Date());
    // Janelas usam o histórico TOTAL do EAN (não só o período do gráfico) — "menor
    // preço em 90 dias" precisa existir mesmo que o usuário esteja vendo os últimos 7.
    const fullHistory: SnapshotPoint[] = (await this.historyModel
      .find({ ean: (item as any).ean })
      .sort({ scannedAt: -1 })
      .limit(400)
      .lean()
      .exec()).map((h: any) => ({
        min: h.stats?.min ?? null,
        count: h.stats?.count ?? 0,
        scannedAt: new Date(h.scannedAt),
        error: h.error,
      }));
    const windowLows: WindowLows = computeWindowLows(fullHistory, new Date());
    const lastWithOffer = [...docs].reverse().find((d: any) => d.bestOffer);

    const [view] = (await this.listItems()).filter((v) => v.id === id);
    return {
      item: view ?? null,
      points: docs.map((h: any) => ({
        scannedAt: h.scannedAt,
        min: h.stats?.min ?? null,
        avg: h.stats?.avg ?? null,
        count: h.stats?.count ?? 0,
        // Preço de tabela do melhor vendedor do ciclo — 2ª série do gráfico (pago vs tabela).
        listPrice: h.bestOffer?.listPrice ?? null,
        error: h.error ?? null,
      })),
      movingAvg: analysis.movingAvg,
      allTimeLow: analysis.allTimeLow,
      windowLows,
      lastBestOffer: (lastWithOffer as any)?.bestOffer ?? null,
    };
  }

  /** Todas as ofertas do último ciclo bem-sucedido, paginadas (já vêm ordenadas por preço). */
  async offers(id: string, page: number, pageSize: number) {
    const item = await this.itemModel.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Item monitorado não encontrado');

    const doc = await this.currentOffersModel.findOne({ ean: (item as any).ean }).lean().exec();
    const all = (doc as any)?.offers ?? [];
    const start = (page - 1) * pageSize;
    return {
      offers: all.slice(start, start + pageSize),
      total: all.length,
      page,
      pageSize,
      scannedAt: (doc as any)?.scannedAt ?? null,
    };
  }

  async deals() {
    const views = await this.listItems();
    const deals = views.filter((v) => v.isDeal);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const alerts = await this.alertModel
      .find({ triggeredAt: { $gte: sevenDaysAgo } })
      .sort({ triggeredAt: -1 })
      .limit(50)
      .lean()
      .exec();

    const nameById = new Map(views.map((v) => [v.id, v.name]));
    return {
      deals,
      alerts: alerts.map((a: any) => ({
        id: String(a._id),
        itemId: String(a.itemId),
        ean: a.ean,
        name: nameById.get(String(a.itemId)) ?? a.ean,
        triggeredAt: a.triggeredAt,
        reason: a.reason,
        currentPrice: a.currentPrice,
        movingAvg: a.movingAvg ?? null,
        bestOffer: a.bestOffer ?? null,
      })),
    };
  }
}
