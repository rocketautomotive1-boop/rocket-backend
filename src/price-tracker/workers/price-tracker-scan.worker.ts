import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MenorPrecoClientService } from '../scraper/menor-preco-client.service';
import { MenorPrecoOffer } from '../scraper/menor-preco.types';
import { TrackedItemModel } from '../schemas/tracked-item.schema';
import { PriceHistoryModel, PriceHistoryBestOffer } from '../schemas/price-history.schema';
import { CurrentOffersModel } from '../schemas/current-offers.schema';
import { PriceAlertService } from '../alerts/price-alert.service';
import { computeAnalysis, SnapshotPoint } from '../analysis/price-analysis';
import { filterOutliers, recomputeStats } from '../analysis/outlier-filter';

/** Máximo de snapshots carregados para análise (>> janela de 14d a 6 scans/dia). */
const ANALYSIS_LOOKBACK = 200;

/**
 * 07h, 10h, 13h, 16h, 19h, 22h — de 3 em 3h, pausado 22h–07h (sem movimento de
 * NFC-e relevante de madrugada, sem motivo pra gastar ciclo de scan nesse horário).
 */
const DEFAULT_SCAN_CRON = '0 7,10,13,16,19,22 * * *';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "RAID MATA MOSCAS" → "Raid Mata Moscas" (a API devolve tudo em caixa alta). */
const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/**
 * Ciclo de scan: consulta cada EAN ativo no serviço Menor Preço (sequencial, com
 * throttle — acesso educado a API pública de governo), grava o snapshot e delega a
 * decisão de alerta. Um EAN com erro nunca derruba o ciclo.
 */
@Injectable()
export class PriceTrackerScanWorker {
  private readonly logger = new Logger(PriceTrackerScanWorker.name);
  private running = false;
  private throttleMs = Number(process.env.PRICE_TRACKER_SCAN_THROTTLE_MS ?? 2000);

  constructor(
    private readonly client: MenorPrecoClientService,
    @InjectModel(TrackedItemModel.name) private readonly itemModel: Model<TrackedItemModel>,
    @InjectModel(PriceHistoryModel.name) private readonly historyModel: Model<PriceHistoryModel>,
    @InjectModel(CurrentOffersModel.name) private readonly currentOffersModel: Model<CurrentOffersModel>,
    private readonly alerts: PriceAlertService,
  ) {}

  @Cron(process.env.PRICE_TRACKER_SCAN_CRON ?? DEFAULT_SCAN_CRON)
  async runCycle(): Promise<void> {
    if (this.running) {
      this.logger.warn('Ciclo anterior ainda em execução — pulando este disparo.');
      return;
    }
    this.running = true;
    try {
      const items = await this.itemModel.find({ active: true }).lean().exec();
      this.logger.log(`Iniciando ciclo de scan: ${items.length} EANs ativos.`);
      for (let i = 0; i < items.length; i++) {
        if (i > 0 && this.throttleMs > 0) await sleep(this.throttleMs);
        try {
          await this.scanEan(items[i].ean);
        } catch (err) {
          // Nunca derruba o ciclo — o snapshot de erro já foi (ou será) registrado.
          this.logger.error(`Scan falhou ean=${items[i].ean}: ${(err as Error).message}`);
        }
      }
      this.logger.log('Ciclo de scan concluído.');
    } catch (err) {
      this.logger.error(`Ciclo de scan abortado: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Escaneia UM EAN: consulta, grava snapshot e avalia alerta. Reusado pelo controller. */
  async scanEan(ean: string): Promise<void> {
    const result = await this.client.fetch(ean);
    const now = new Date();

    if (result.error || !result.stats || result.stats.min == null) {
      await this.historyModel.create({
        ean, scannedAt: now, stats: result.stats ?? null, bestOffer: null,
        error: result.error ?? (result.stats ? null : 'no_stats'),
      });
      // count 0 / sem stats não é erro de coleta quando error é null — mas sem
      // preço não há o que analisar em nenhum dos casos.
      return;
    }

    // Análise usa o histórico ANTERIOR ao snapshot atual ("all-time low anterior",
    // movingAvg pra base do filtro de outlier abaixo).
    const history = await this.historyModel
      .find({ ean })
      .sort({ scannedAt: -1 })
      .limit(ANALYSIS_LOOKBACK)
      .lean()
      .exec();
    const points: SnapshotPoint[] = history.map((h: any) => ({
      min: h.stats?.min ?? null,
      median: h.stats?.median ?? null,
      count: h.stats?.count ?? 0,
      scannedAt: new Date(h.scannedAt),
      error: h.error,
    }));
    const analysis = computeAnalysis(points, now);

    // Ofertas com desvio extremo vs. movingAvg (venda fracionada de fardo/caixa,
    // erro de digitação de NFC-e) são marcadas suspicious — nunca viram bestOffer
    // nem entram no recálculo de stats abaixo, mas continuam na lista completa
    // do ciclo (auditoria). Sem movingAvg ainda (item novo), filtro fica inativo.
    const mappedOffers = filterOutliers(this.mapAndSortOffers(result.offers), analysis.movingAvg);
    const bestOffer = mappedOffers.find((o) => !o.suspicious) ?? null;

    // current = preço da MELHOR OFERTA DETALHADA (loja/endereço rastreáveis), não
    // result.stats.min. stats.min vem do campo agregado `precos.min` da API —
    // reflete TODAS as ofertas do GTIN, sem o filtro de UF/paginação que já foi
    // aplicado a `offers`. Se a oferta mais barata da API estiver fora de PE ou
    // além das páginas buscadas, stats.min mostra um preço "fantasma" que não
    // corresponde a nenhuma oferta visível na lista do app.
    if (!bestOffer) {
      await this.historyModel.create({
        ean, scannedAt: now, stats: result.stats, bestOffer: null, error: 'no_offers',
      });
      return;
    }
    const current = bestOffer.price as number;

    // stats.median/avg/count recalculados só com ofertas NÃO-suspeitas — sobrescreve
    // o que veio da API/scraper (que soma TODAS as ofertas, incluindo outliers).
    // stats.min/max continuam vindo da API (extremo agregado, base do all_time_low).
    const recomputed = recomputeStats(mappedOffers);
    const stats = { ...result.stats, median: recomputed.median, avg: recomputed.avg, count: recomputed.count };

    await this.historyModel.create({
      ean, scannedAt: now, stats, bestOffer, error: null,
    });
    // Ofertas completas do ciclo (não histórico — upsert, só o mais recente por EAN).
    await this.currentOffersModel.updateOne(
      { ean },
      { $set: { ean, scannedAt: now, offers: mappedOffers } },
      { upsert: true },
    ).exec();

    const item = await this.itemModel.findOne({ ean }).lean().exec();
    if (!item) return; // item removido entre a coleta e a análise

    // Nome automático: o cadastro é só por EAN; o `desc` da API preenche o nome
    // (só quando vazio — renomeações do usuário são preservadas).
    if (!(item as any).name && result.desc) {
      const name = titleCase(result.desc);
      await this.itemModel.updateOne({ _id: item._id }, { $set: { name } }).exec();
      (item as any).name = name;
    }

    await this.alerts.processSnapshot(
      item as any, current, stats.count, analysis, bestOffer,
    );
  }

  /** Todas as ofertas com preço, mapeadas e ordenadas da mais barata pra mais cara. */
  private mapAndSortOffers(offers: MenorPrecoOffer[]): PriceHistoryBestOffer[] {
    return offers
      .filter((o) => o.price != null)
      .map((o) => ({
        price: o.price ?? null,
        listPrice: o.list_price ?? null,
        savings: o.savings ?? null,
        sellerName: o.seller_name ?? null,
        address: o.address ?? null,
        bairro: o.bairro ?? null,
        distKm: o.dist_km ?? null,
        soldAt: o.sold_at ?? null,
        soldAgo: o.sold_ago ?? null,
      }))
      .sort((a, b) => (a.price as number) - (b.price as number));
  }
}
