import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleSerpDiscoveryAdapter } from '../../marketplace/adapters/google/google-serp-discovery.adapter';
import { AiBatchService } from '../../ai/ai-batch.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../../queue/schemas/queue-record.schema';
import { ProductDiscoveryModel, ProductDiscoveryDocument } from '../schemas/product-discovery.schema';

@Injectable()
export class DiscoveryWorker {
    private readonly logger = new Logger(DiscoveryWorker.name);

    constructor(
        private readonly serpAdapter: GoogleSerpDiscoveryAdapter,
        private readonly aiService: AiBatchService,
        @InjectModel('QueueRecordModel')
        private readonly queueModel: Model<QueueRecordDocument>,
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.inventory',
        routingKey: 'product.discovery.request',
        queue: 'product.discovery.request',
    })
    async handleDiscoveryRequest(msg: { jobId: string; query: string; queueRecordId: string; productId?: string }) {
        this.logger.log(`Processing discovery request for jobId: ${msg.jobId}`);

        try {
            // Update status to processing
            await this.queueModel.findByIdAndUpdate(msg.queueRecordId, {
                status: 'processing',
                startedAt: new Date(),
            });

            this.eventEmitter.emit('queue.job.update', {
                jobId: msg.jobId,
                status: 'PROCESSING',
                productId: msg.productId
            });

            // 1. Process search using Google SERP adapter (unauthenticated)
            const rawData = await this.serpAdapter.search(msg.query);

            // 2. Clean and process data USING AI
            const processedData = await this.aiService.sanitizeDiscoveryData(msg.query, rawData.items);

            // 3. Save to ProductDiscovery collection
            await this.discoveryModel.create({
                productId: msg.productId ? new Types.ObjectId(msg.productId) : undefined,
                query: msg.query,
                batchId: msg.jobId,
                status: 'done',
                data: processedData,
                rawItems: rawData.items,
            });

            // 4. Update status to completed in the QueueRecord
            await this.queueModel.findByIdAndUpdate(msg.queueRecordId, {
                status: 'completed',
                completedAt: new Date(),
                result: processedData,
            });

            this.eventEmitter.emit('queue.job.update', {
                jobId: msg.jobId,
                status: 'COMPLETED',
                result: processedData,
                productId: msg.productId
            });

            this.logger.log(`Google SERP + AI Discovery completed for jobId: ${msg.jobId}`);
        } catch (error) {
            this.logger.error(`Error processing discovery for jobId: ${msg.jobId}: ${error.message}`);
            await this.queueModel.findByIdAndUpdate(msg.queueRecordId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });

            this.eventEmitter.emit('queue.job.update', {
                jobId: msg.jobId,
                status: 'FAILED',
                error: error.message,
                productId: msg.productId
            });
        }
    }
}
