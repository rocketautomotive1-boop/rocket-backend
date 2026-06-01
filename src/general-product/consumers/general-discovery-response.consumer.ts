// backend/src/general-product/consumers/general-discovery-response.consumer.ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { GeneralProductRepository } from '../general-product.repository';

interface GeneralDiscoveryResponse {
  jobId: string;
  barcode: string;
  status: 'completed' | 'failed';
  result?: Record<string, any>;
  priceStats?: { min: number | null; avg: number | null; max: number | null; count: number } | null;
  images?: string[];
  sources?: Record<string, any>;
  error?: string;
  scrapedAt?: string;
}

/**
 * Consome discovery.general.response e grava o enriquecimento em
 * GeneralProduct.draftData (idempotente por barcode). Erro não derruba o worker.
 */
@Injectable()
export class GeneralDiscoveryResponseConsumer {
  private readonly logger = new Logger(GeneralDiscoveryResponseConsumer.name);

  constructor(private readonly repo: GeneralProductRepository) {}

  @RabbitSubscribe({
    exchange: 'rocket.inventory',
    routingKey: 'discovery.general.response',
    queue: 'discovery.general.response',
    queueOptions: { durable: true },
  })
  async handle(msg: GeneralDiscoveryResponse): Promise<void> {
    if (msg.status !== 'completed' || !msg.result) {
      this.logger.warn(`General discovery ${msg.jobId} not applied: status=${msg.status} hasResult=${!!msg.result}`);
      return;
    }
    // Grava o enriquecimento da IA + preços/imagens reais do ML (quando houver).
    const draft = {
      ...msg.result,
      priceStats: msg.priceStats ?? null,
      images: msg.images ?? [],
      sources: msg.sources ?? null,
    };
    await this.repo.upsertDraftByBarcode(msg.barcode, draft);
    const mlCount = msg.sources?.mercadolivre?.items?.length ?? 0;
    this.logger.log(`General discovery draft saved: jobId=${msg.jobId} barcode=${msg.barcode} (priceStats=${!!msg.priceStats} images=${msg.images?.length ?? 0} mlListings=${mlCount})`);
  }
}
