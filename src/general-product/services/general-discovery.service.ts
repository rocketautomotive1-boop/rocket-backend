// backend/src/general-product/services/general-discovery.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import { isValidEan13 } from '../validation/ean13';

const EXCHANGE = 'rocket.inventory';
const ROUTING_KEY = 'discovery.general.request';

/**
 * Origem do discovery de itens gerais. Publica um job por barcode (EAN/GTIN) na
 * routing key `discovery.general.request`, paralela ao fluxo de autopeças.
 * Não persiste nada nesta fatia — apenas valida e publica (SRP).
 */
@Injectable()
export class GeneralDiscoveryService {
  private readonly logger = new Logger(GeneralDiscoveryService.name);

  constructor(private readonly amqp: AmqpConnection) {}

  async startByBarcode(barcode: string, domain = 'general'): Promise<string> {
    if (!isValidEan13(barcode)) {
      throw new BadRequestException('Código de barras EAN-13 inválido.');
    }
    const jobId = randomUUID();
    await this.amqp.publish(EXCHANGE, ROUTING_KEY, { jobId, barcode, query: barcode, domain });
    this.logger.log(`General discovery dispatched: jobId=${jobId} barcode=${barcode} domain=${domain}`);
    return jobId;
  }
}
