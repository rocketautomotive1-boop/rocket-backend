import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductDiscoveryDocument } from '../schemas/product-discovery.schema';
import { mapDiscoveryDocToAppData } from '../dto/discovery-app.mapper';
import { DiscoveryRealtimeEvent } from '../types/discovery-realtime-event';
import { SourceBlock, SourceRefreshResponse } from '../dto/source-refresh.dto';

/**
 * Persiste o resultado do refresh isolado de UMA fonte (publicado pelo discovery)
 * e emite WebSocket. Save delta-only: `$set` por caminho aninhado em
 * `sources.<source>` — toca SÓ a fonte, sem mexer nas demais. Guard contra null:
 * erro/timeout/vazio NÃO sobrescreve um bloco bom. Upsert por productId cria um
 * doc de discovery mínimo quando o produto nunca rodou discovery.
 */
@Injectable()
export class SourceRefreshResponseConsumer {
  private readonly logger = new Logger(SourceRefreshResponseConsumer.name);

  constructor(
    @InjectModel('ProductDiscoveryModel')
    private readonly discoveryModel: Model<ProductDiscoveryDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @RabbitSubscribe({
    exchange: 'rocket.inventory',
    routingKey: 'discovery.source.refresh.response',
    queue: 'discovery.source.refresh.response',
    queueOptions: { durable: true },
  })
  async handle(msg: SourceRefreshResponse): Promise<void> {
    const { productId, source, jobId, block, error } = msg;
    this.logger.log(
      `Source refresh response: source=${source} productId=${productId} jobId=${jobId} block=${block ? 'ok' : 'null'}`,
    );

    if (!block) {
      // Nunca sobrescreve um bloco bom com null/erro.
      this.emit({ jobId, status: 'FAILED', error: error ?? 'empty_or_failed' });
      return;
    }

    if (!Types.ObjectId.isValid(productId)) {
      this.logger.warn(`Source refresh response com productId inválido: ${productId}`);
      this.emit({ jobId, status: 'FAILED', error: 'invalid_product' });
      return;
    }

    const productObjectId = new Types.ObjectId(productId);
    const sourceBlock = this.withConfidence(block);

    await this.discoveryModel.updateOne(
      { productId: productObjectId, isActiveIntent: true, status: { $ne: 'superseded' } },
      {
        $set: {
          [`sources.${source}`]: sourceBlock,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          batchId: jobId,
          productId: productObjectId,
          query: '',
          status: 'done',
          isActiveIntent: true,
          intentVersion: 1,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    ).exec();

    // Relê o doc ativo para emitir o contrato normalizado (DiscoveryAppData),
    // consistente com o WS da discovery completa.
    const doc = await this.discoveryModel
      .findOne({ productId: productObjectId, isActiveIntent: true, status: { $ne: 'superseded' } })
      .select('final sources resolvedCategoryId query')
      .lean()
      .exec();

    this.emit({
      jobId,
      status: 'COMPLETED',
      result: doc ? mapDiscoveryDocToAppData(doc) : undefined,
    });

    this.logger.log(`sources.${source} atualizado para product=${productId} (jobId=${jobId})`);
  }

  /** Deriva confidence consistente com o save da discovery completa. */
  private withConfidence(block: SourceBlock): SourceBlock & { confidence: string } {
    const confidence = (block.offers?.length ?? 0) > 0 ? 'high' : 'none';
    return { ...block, confidence };
  }

  private emit(event: DiscoveryRealtimeEvent): void {
    this.eventEmitter.emit('queue.job.update', event);
  }
}
