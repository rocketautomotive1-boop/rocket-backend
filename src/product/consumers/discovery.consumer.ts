import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleSerpDiscoveryAdapter } from '../../marketplace/adapters/google/google-serp-discovery.adapter';
import { AiBatchService } from '../../ai/ai-batch.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../../queue/schemas/queue-record.schema';
import { ProductDiscoveryModel, ProductDiscoveryDocument } from '../schemas/product-discovery.schema';
import { ProductModel } from '../schemas/product.schema';
import { computeDiscoveryDedupFields } from '../utils/discovery-dedup.util';

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
        @InjectModel('ProductModel')
        private readonly productModel: Model<any>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.inventory',
        routingKey: 'product.discovery.request',
        queue: 'product.discovery.request',
    })
    async handleDiscoveryRequest(msg: {
        jobId: string;
        query: string;
        queueRecordId: string;
        productId?: string;
        partNumber?: string;
        brand?: string;
        isGenuine?: boolean;
        brandId?: string;
    }) {
        this.logger.log(`Processing discovery request for jobId: ${msg.jobId}`);

        // Hard timeout: if the job hangs for any reason, reject after 90s so the
        // RabbitMQ message is always ack'd and resources are released.
        const JOB_TIMEOUT_MS = 90_000;
        const timeoutError = new Error(`Discovery job timed out after ${JOB_TIMEOUT_MS / 1000}s`);
        const jobTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(timeoutError), JOB_TIMEOUT_MS)
        );

        try {
            await Promise.race([this.runDiscovery(msg), jobTimeout]);
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

    private async runDiscovery(msg: {
        jobId: string;
        query: string;
        queueRecordId: string;
        productId?: string;
        partNumber?: string;
        brand?: string;
        isGenuine?: boolean;
        brandId?: string;
    }) {
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

        // 1. SERP search
        const rawData = await this.serpAdapter.search(msg.query);

        // 2. Clean and enrich data with AI
        const processedData = await this.aiService.sanitizeDiscoveryData(msg.query, rawData.items);

        // Most frequent category_path from SERP results
        const categoryPaths = rawData.items.map((it: any) => it.category_path).filter(Boolean);
        if (categoryPaths.length > 0) {
            const counts = categoryPaths.reduce((acc: any, val: string) => {
                acc[val] = (acc[val] || 0) + 1;
                return acc;
            }, {});
            processedData.categoryPath = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
        }

        const pnRaw = msg.partNumber?.trim() || msg.query.split(/\s+/)[0] || '';
        const dedup = computeDiscoveryDedupFields({
            partNumber: pnRaw,
            brand: msg.brand,
            isGenuine: msg.isGenuine,
        });

        // 3. Save result
        const brandOid =
            msg.brandId && Types.ObjectId.isValid(msg.brandId) ? new Types.ObjectId(msg.brandId) : undefined;

        const discoveryDoc = await this.discoveryModel.create({
            productId: msg.productId ? new Types.ObjectId(msg.productId) : undefined,
            query: msg.query,
            batchId: msg.jobId,
            status: 'done',
            data: processedData,
            rawItems: rawData.items,
            partNumberNorm: dedup.partNumberNorm,
            brandNorm: dedup.brandNorm,
            isGenuine: dedup.isGenuine,
            ...(brandOid ? { brandId: brandOid } : {}),
        });

        // Eager auto-associate: if productId wasn't provided, try to find product by partNumber
        let resolvedProductId = msg.productId;
        if (!resolvedProductId) {
            const partNumber = msg.query.split(' ')[0];
            if (partNumber) {
                const matched = await this.productModel.findOne({ partNumber })
                    .select('_id').lean().exec();
                if (matched) {
                    resolvedProductId = matched._id.toString();
                    await this.discoveryModel.updateOne(
                        { _id: discoveryDoc._id },
                        { $set: { productId: matched._id } },
                    );
                    this.logger.log(`Eager-associated discovery ${discoveryDoc._id} → product ${resolvedProductId}`);
                }
            }
        }

        // Auto-apply oemCodes to product if available
        if (resolvedProductId && processedData.oemCodes?.length > 0) {
            await this.productModel.updateOne(
                { _id: new Types.ObjectId(resolvedProductId) },
                { $addToSet: { oemCodes: { $each: processedData.oemCodes } } },
            );
            this.logger.log(`Applied ${processedData.oemCodes.length} OEM codes to product ${resolvedProductId}`);
        }

        const completedResult = { ...processedData, rawItems: rawData.items, _discoveryId: (discoveryDoc._id as Types.ObjectId).toString() };
        await this.queueModel.findByIdAndUpdate(msg.queueRecordId, {
            status: 'completed',
            completedAt: new Date(),
            result: completedResult,
        });

        this.eventEmitter.emit('queue.job.update', {
            jobId: msg.jobId,
            status: 'COMPLETED',
            result: completedResult,
            productId: resolvedProductId || msg.productId,
        });

        this.logger.log(`Discovery completed for jobId: ${msg.jobId}`);
    }
}
