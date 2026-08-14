import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  BadGatewayException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import { SourceName, SourceRefreshRequest } from '../dto/source-refresh.dto';

const EXCHANGE = 'rocket.inventory';
const REQUEST_ROUTING_KEY = 'discovery.source.refresh';

/**
 * Dispara o refresh isolado de UMA fonte de um produto (ex.: só Menor Preço),
 * sem rodar a discovery completa. Publica o pedido para o discovery; a resposta
 * volta de forma assíncrona e é tratada pelo SourceRefreshResponseConsumer.
 */
@Injectable()
export class SourceRefreshService {
  private readonly logger = new Logger(SourceRefreshService.name);

  constructor(
    @InjectModel('ProductModel')
    private readonly productModel: Model<any>,
    private readonly amqp: AmqpConnection,
  ) {}

  async requestRefresh(params: { productId: string; source: SourceName }): Promise<{ jobId: string }> {
    const { productId, source } = params;

    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const product = await this.productModel
      .findById(productId)
      .select('barcode')
      .lean()
      .exec();

    if (!product) {
      throw new NotFoundException('Produto não encontrado.');
    }

    const barcode = String(product.barcode ?? '').trim();
    if (!barcode) {
      throw new UnprocessableEntityException(
        'Produto sem código de barras (barcode); não é possível atualizar esta fonte.',
      );
    }

    const jobId = randomUUID();
    const correlationId = randomUUID();
    const request: SourceRefreshRequest = { productId, source, barcode, correlationId, jobId };

    try {
      await this.amqp.publish(EXCHANGE, REQUEST_ROUTING_KEY, request);
    } catch (err: any) {
      this.logger.error(`Falha ao publicar refresh de fonte: ${err?.message}`);
      throw new BadGatewayException('Falha ao enfileirar a atualização da fonte. Tente novamente.');
    }

    this.logger.log(`Source refresh enfileirado: source=${source} productId=${productId} jobId=${jobId}`);
    return { jobId };
  }
}
