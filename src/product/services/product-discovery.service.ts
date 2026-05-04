import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductDiscoveryDocument, ProductDiscoveryModel } from '../schemas/product-discovery.schema';
import { Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';
import { computeDiscoveryDedupFields, normalizePartNumberForDedup } from '../utils/discovery-dedup.util';

@Injectable()
export class ProductDiscoveryService implements OnApplicationBootstrap {
    private readonly logger = new Logger(ProductDiscoveryService.name);

    constructor(
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
        @InjectModel('ProductModel')
        private readonly productModel: Model<any>,
        private readonly amqpConnection: AmqpConnection,
    ) { }


    async onApplicationBootstrap(): Promise<void> {
        // On startup, recover any jobs left in pending state from before the server went down.
        // Threshold: 5 minutes — any pending job older than this was orphaned by a crash/restart.
        const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
        const stale = await this.discoveryModel
            .find({ status: 'pending', createdAt: { $lt: staleThreshold } })
            .lean()
            .exec();

        if (stale.length === 0) return;

        this.logger.warn(`Recovery: found ${stale.length} stale pending job(s) — re-publishing to RabbitMQ`);

        for (const job of stale) {
            const newJobId = uuidv4();
            try {
                await this.discoveryModel.updateOne(
                    { _id: job._id },
                    { $set: { batchId: newJobId, updatedAt: new Date() } },
                ).exec();

                await this.amqpConnection.publish('rocket.inventory', 'discovery.scraper.request', {
                    jobId: newJobId,
                    query: job.query,
                    partNumber: job.partNumberNorm,
                    brand: job.brandNorm,
                });

                this.logger.log(`Recovery: re-published job ${job.batchId} → ${newJobId} (query="${job.query}")`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`Recovery: failed to re-publish job ${job.batchId}: ${message}`);
                await this.discoveryModel.updateOne(
                    { _id: job._id },
                    { $set: { status: 'failed', error: 'RECOVERY_PUBLISH_ERROR' } },
                ).exec();
            }
        }
    }

    async startDiscovery(params: {
        partNumber: string;
        brand?: string;
        productId?: string;
    }): Promise<string> {
        const { partNumber, brand, productId } = params;
        const dedup = computeDiscoveryDedupFields({ partNumber, brand, isGenuine: false });
        const { partNumberNorm, brandNorm } = dedup;

        // 1. Check for existing job (Done or Pending)
        const existing = await this.discoveryModel.findOne({
            partNumberNorm,
            brandNorm,
            isGenuine: false,
            status: { $in: ['done', 'pending'] }
        }).sort({ createdAt: -1 }).exec();

        if (existing) {
            const isRecent = existing.status === 'done' && existing.updatedAt > new Date(Date.now() - 24 * 60 * 60 * 1000);
            const isStuckPending = existing.status === 'pending' && existing.updatedAt < new Date(Date.now() - 2 * 60 * 1000); // 2 min timeout

            if ((existing.status === 'pending' && !isStuckPending) || isRecent) {
                this.logger.log(`Reusing discovery [${existing.status}] ${existing.batchId} for PN=${partNumberNorm}`);
                if (productId) await this.linkProductIdToDiscoveryIfNeeded(existing._id, productId);
                return existing.batchId;
            }
            if (isStuckPending) {
                this.logger.warn(`Found STUCK pending job ${existing.batchId} for PN=${partNumberNorm}, retrying...`);
            }
        }

        // 2. Start NEW job
        const jobId = uuidv4();
        const query = `${partNumber} ${brand || ''}`.trim();

        await this.discoveryModel.findOneAndUpdate(
            { partNumberNorm, brandNorm, isGenuine: false },
            {
                $set: {
                    batchId: jobId,
                    status: 'pending',
                    query,
                    productId: productId ? new Types.ObjectId(productId) : undefined,
                    updatedAt: new Date(),
                },
                $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true, new: true }
        ).exec();

        this.logger.log(`🚀 Dispatching discovery to MS: ${query} (JobId: ${jobId})`);

        try {
            const published = await this.amqpConnection.publish('rocket.inventory', 'discovery.scraper.request', {
                jobId,
                query,
                partNumber,
                brand,
            });
            this.logger.log(`📤 Published message to RabbitMQ: ${published ? 'YES' : 'NO'}`);
        } catch (err) {
            this.logger.error(`❌ FAILED to publish to RabbitMQ: ${err.message}`);
            // Update status to failed so it doesn't stay pending
            await this.discoveryModel.updateOne({ batchId: jobId }, { $set: { status: 'failed', error: 'MQ_PUBLISH_ERROR' } });
            throw err;
        }

        return jobId;
    }


    private async linkProductIdToDiscoveryIfNeeded(
        discoveryDocId: Types.ObjectId | string,
        productId: string | undefined,
    ): Promise<void> {
        if (!productId) return;
        const pid = new Types.ObjectId(productId);
        const doc = await this.discoveryModel.findById(discoveryDocId).select('productId').lean().exec();
        if (!doc || doc.productId) return;

        await this.discoveryModel.updateOne({ _id: discoveryDocId }, { $set: { productId: pid } }).exec();
        this.logger.log(`Linked discovery ${discoveryDocId} → product ${productId}`);
    }

    async getStatus(jobId: string) {
        const fromDiscovery = await this.discoveryModel.findOne({ batchId: jobId }).lean().exec();
        if (!fromDiscovery) return { status: 'NOT_FOUND' };

        const statusMap: Record<string, string> = {
            'pending': 'PENDING',
            'done': 'COMPLETED',
            'failed': 'FAILED'
        };

        const result = {
            jobId,
            status: statusMap[fromDiscovery.status] || fromDiscovery.status.toUpperCase(),
            data: fromDiscovery.status === 'done' ? {
                ...(fromDiscovery.final || fromDiscovery.data),
                _discoveryId: String(fromDiscovery._id),
            } : undefined,
            error: fromDiscovery.error,
            updatedAt: (fromDiscovery as { updatedAt?: Date }).updatedAt,
        };

        return result;
    }

    async findByProductId(productId: string) {
        const oid = new Types.ObjectId(productId);

        // Fast path: direct match by productId
        const direct = await this.discoveryModel.find({ productId: oid })
            .sort({ createdAt: -1 }).lean().exec();
        if (direct.length > 0) return direct;

        // Fallback: search orphan discoveries by the product's partNumber
        const product = await this.productModel.findById(oid).select('partNumber').lean().exec();
        if (!product?.partNumber) return [];

        const escaped = product.partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fallback = await this.discoveryModel.find({
            productId: { $in: [null, undefined] },
            query: { $regex: `^${escaped}\\b`, $options: 'i' },
        }).sort({ createdAt: -1 }).lean().exec();

        // Lazy-associate so next lookup is instant
        if (fallback.length > 0) {
            const ids = fallback.map(d => d._id);
            await this.discoveryModel.updateMany(
                { _id: { $in: ids } },
                { $set: { productId: oid } },
            ).exec();
            this.logger.log(`Lazy-associated ${ids.length} discoveries → product ${productId}`);
        }

        return fallback;
    }

    async findRecent(limit = 20) {
        return this.discoveryModel.find()
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
            .exec();
    }

    async search(term: string) {
        return this.discoveryModel.find({
            $or: [
                { query: { $regex: term, $options: 'i' } },
                { "data.partNumber": { $regex: term, $options: 'i' } }
            ]
        })
            .sort({ updatedAt: -1 })
            .limit(5)
            .lean()
            .exec();
    }

    async associateProduct(discoveryId: string, productId: string): Promise<void> {
        await this.discoveryModel.updateOne(
            { _id: new Types.ObjectId(discoveryId) },
            { $set: { productId: new Types.ObjectId(productId) } },
        ).exec();
        this.logger.log(`Associated discovery ${discoveryId} → product ${productId}`);
    }


    async findByPartNumberAndBrand(
        partNumber: string,
        brandId?: string,
    ): Promise<ProductDiscoveryDocument | null> {
        const partNumberNorm = normalizePartNumberForDedup(partNumber);

        const query: any = {
            partNumberNorm,
            status: 'done',
        };

        if (brandId) {
            query.brandId = new Types.ObjectId(brandId);
        }

        return this.discoveryModel
            .findOne(query)
            .sort({ createdAt: -1 })
            .lean()
            .exec();
    }
}
