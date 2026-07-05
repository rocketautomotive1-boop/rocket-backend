import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import {
  MenorPrecoRequest, MenorPrecoResult,
  SCRAPER_EXCHANGE, MENOR_PRECO_REQUEST_RK, TRACKER_RESULT_RK,
} from './menor-preco.types';

interface PendingEntry {
  resolve: (data: MenorPrecoResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * Request/response correlacionado com o scraper (fluxo menor_preco), na fila de
 * resposta EXCLUSIVA do tracker (reply_to). Nunca rejeita: erro vem em result.error.
 */
@Injectable()
export class MenorPrecoClientService implements OnModuleDestroy {
  private readonly logger = new Logger(MenorPrecoClientService.name);
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly amqp: AmqpConnection) {}

  async fetch(ean: string): Promise<MenorPrecoResult> {
    const timeoutMs = Number(process.env.PRICE_TRACKER_RESULT_TIMEOUT_MS ?? 30_000);
    const correlationId = randomUUID();
    const request: MenorPrecoRequest = {
      job_id: randomUUID(),
      correlation_id: correlationId,
      gtin: ean,
      reply_to: TRACKER_RESULT_RK,
    };

    return new Promise<MenorPrecoResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        this.logger.warn(`MenorPreco timeout ean=${ean} correlationId=${correlationId}`);
        resolve({ correlation_id: correlationId, ean, offers: [], error: 'timeout' });
      }, timeoutMs);

      this.pending.set(correlationId, { resolve, timer });

      this.amqp.publish(SCRAPER_EXCHANGE, MENOR_PRECO_REQUEST_RK, request).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        this.logger.error(`Falha ao publicar menor_preco request: ${err.message}`);
        resolve({ correlation_id: correlationId, ean, offers: [], error: 'publish_error' });
      });
    });
  }

  resolveResult(result: MenorPrecoResult): void {
    const entry = this.pending.get(result.correlation_id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(result.correlation_id);
    entry.resolve(result);
  }

  onModuleDestroy(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ correlation_id: '', ean: '', offers: [], error: 'shutdown' });
    }
    this.pending.clear();
  }
}
