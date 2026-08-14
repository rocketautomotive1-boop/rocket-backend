import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MenorPrecoClientService } from './menor-preco-client.service';
import { MenorPrecoResult, SCRAPER_EXCHANGE, TRACKER_RESULT_RK } from './menor-preco.types';

@Injectable()
export class MenorPrecoTrackerResultConsumer {
  private readonly logger = new Logger(MenorPrecoTrackerResultConsumer.name);

  constructor(private readonly client: MenorPrecoClientService) {}

  @RabbitSubscribe({
    exchange: SCRAPER_EXCHANGE,
    routingKey: TRACKER_RESULT_RK,
    queue: TRACKER_RESULT_RK,
    queueOptions: { durable: true },
  })
  async handleResult(result: MenorPrecoResult): Promise<void> {
    this.logger.log(
      `MenorPreco tracker result: correlationId=${result.correlation_id} offers=${result.offers?.length ?? 0} error=${result.error ?? 'none'}`,
    );
    this.client.resolveResult(result);
  }
}
