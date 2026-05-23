import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductDiscoveryDocument, ProductDiscoveryModel } from '../schemas/product-discovery.schema';
import { Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';
import { computeDiscoveryDedupFields, normalizePartNumberForDedup } from '../utils/discovery-dedup.util';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DiscoveryAppData, DiscoveryAppDocument, DiscoveryVehicleSuggestion } from '../dto/discovery-app.dto';
import { DiscoveryRealtimeEvent } from '../types/discovery-realtime-event';

@Injectable()
export class ProductDiscoveryService implements OnApplicationBootstrap {
    private readonly logger = new Logger(ProductDiscoveryService.name);
    private readonly stalePendingMinutes = Number(process.env.DISCOVERY_PENDING_TTL_MINUTES ?? 12);

    constructor(
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
        @InjectModel('ProductModel')
        private readonly productModel: Model<any>,
        private readonly amqpConnection: AmqpConnection,
        private readonly eventEmitter: EventEmitter2,
    ) { }


    async onApplicationBootstrap(): Promise<void> {
        // On startup, recover any jobs left in pending state from before the server went down.
        // Threshold: 5 minutes — any pending job older than this was orphaned by a crash/restart.
        const staleThreshold = new Date(Date.now() - this.stalePendingMinutes * 60 * 1000);
        const stale = await this.discoveryModel
            .find({ status: 'pending', createdAt: { $lt: staleThreshold } })
            .lean()
            .exec();

        if (stale.length === 0) return;

        this.logger.warn(`Recovery: found ${stale.length} stale pending job(s) (>${this.stalePendingMinutes}m) - re-publishing to RabbitMQ`);

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

    // Runs every 2 minutes — marks as failed any job stuck in pending for more than 5 minutes.
    // Covers cases where the discovery MS crashed after receiving but before publishing the response.
    @Cron('*/2 * * * *')
    async failStalePendingJobs(): Promise<void> {
        const threshold = new Date(Date.now() - this.stalePendingMinutes * 60 * 1000);

        // Find stale jobs BEFORE marking them, so we have their batchIds for WS notification
        const staleJobs = await this.discoveryModel
            .find({ status: 'pending', updatedAt: { $lt: threshold } })
            .select('batchId')
            .lean()
            .exec();

        if (staleJobs.length === 0) return;

        await this.discoveryModel.updateMany(
            { status: 'pending', updatedAt: { $lt: threshold } },
            { $set: { status: 'failed', error: 'TIMEOUT_NO_RESPONSE' } },
        ).exec();

        this.logger.warn(`TTL recovery: marked ${staleJobs.length} stale job(s) as failed (>${this.stalePendingMinutes}m)`);

        // Notify any connected WebSocket clients that their job has failed
        for (const job of staleJobs) {
            const event: DiscoveryRealtimeEvent = {
                jobId: job.batchId,
                status: 'FAILED',
                error: 'TIMEOUT_NO_RESPONSE',
            };
            this.eventEmitter.emit('queue.job.update', event);
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
        const productObjectId = productId ? new Types.ObjectId(productId) : undefined;

        // 0. Product-scoped intent model: explicit runs always create a new active intent.
        // Reuse the active intent when signature is unchanged (idempotency),
        // otherwise create a new intent and supersede the previous one.
        if (productObjectId) {
            const latestByProduct = await this.discoveryModel.findOne({
                productId: productObjectId,
                isActiveIntent: true,
            })
                .sort({ intentVersion: -1, createdAt: -1 })
                .select('intentVersion batchId partNumberNorm brandNorm isGenuine status updatedAt')
                .lean()
                .exec();

            if (
                latestByProduct &&
                latestByProduct.partNumberNorm === partNumberNorm &&
                latestByProduct.brandNorm === brandNorm &&
                latestByProduct.isGenuine === false &&
                ['pending', 'done'].includes(String(latestByProduct.status))
            ) {
                const isStuckPending = latestByProduct.status === 'pending'
                    && latestByProduct.updatedAt
                    && latestByProduct.updatedAt < new Date(Date.now() - this.stalePendingMinutes * 60 * 1000);

                if (!isStuckPending) {
                    this.logger.log(
                        `Reusing active discovery intent v${latestByProduct.intentVersion} for product=${productId} (jobId=${latestByProduct.batchId})`,
                    );
                    return String(latestByProduct.batchId);
                }
            }

            const nextIntentVersion = Number(latestByProduct?.intentVersion ?? 0) + 1;
            const jobId = uuidv4();
            const query = `${partNumber} ${brand || ''}`.trim();

            await this.discoveryModel.updateMany(
                { productId: productObjectId, isActiveIntent: true },
                {
                    $set: {
                        isActiveIntent: false,
                        supersededAt: new Date(),
                        updatedAt: new Date(),
                    },
                },
            ).exec();

            await this.discoveryModel.create({
                batchId: jobId,
                status: 'pending',
                query,
                partNumberNorm,
                brandNorm,
                isGenuine: false,
                productId: productObjectId,
                intentVersion: nextIntentVersion,
                isActiveIntent: true,
                supersededAt: null,
            });

            this.logger.log(`Dispatching discovery intent v${nextIntentVersion} for product=${productId} (jobId=${jobId})`);

            try {
                const published = await this.amqpConnection.publish('rocket.inventory', 'discovery.scraper.request', {
                    jobId,
                    query,
                    partNumber,
                    brand,
                    productId,
                    intentVersion: nextIntentVersion,
                });
                this.logger.log(`Published message to RabbitMQ: ${published ? 'YES' : 'NO'}`);
            } catch (err: any) {
                this.logger.error(`FAILED to publish to RabbitMQ: ${err?.message}`);
                await this.discoveryModel.updateOne(
                    { batchId: jobId },
                    {
                        $set: {
                            status: 'failed',
                            error: 'MQ_PUBLISH_ERROR',
                            isActiveIntent: false,
                            supersededAt: new Date(),
                        },
                    },
                ).exec();
                throw err;
            }

            return jobId;
        }

        // 1. Non product-scoped fallback: preserve previous dedup behavior.
        const existing = await this.discoveryModel.findOne({
            partNumberNorm,
            brandNorm,
            isGenuine: false,
            status: { $in: ['done', 'pending'] },
            productId: { $in: [null, undefined] },
        }).sort({ createdAt: -1 }).exec();

        if (existing) {
            const isStuckPending = existing.status === 'pending' && existing.updatedAt < new Date(Date.now() - 2 * 60 * 1000); // 2 min timeout

            if ((existing.status === 'pending' && !isStuckPending) || existing.status === 'done') {
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
            { partNumberNorm, brandNorm, isGenuine: false, productId: { $in: [null, undefined] } },
            {
                $set: {
                    batchId: jobId,
                    status: 'pending',
                    query,
                    productId: productObjectId,
                    intentVersion: 1,
                    isActiveIntent: false,
                    supersededAt: null,
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

        const normalized = this.toDiscoveryAppDocument(fromDiscovery as any);
        const result = {
            jobId,
            status: statusMap[fromDiscovery.status] || fromDiscovery.status.toUpperCase(),
            data: fromDiscovery.status === 'done' ? normalized.data : undefined,
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
        if (direct.length > 0) return direct.map((doc) => this.toDiscoveryAppDocument(doc as any));

        // Fallback: search orphan discoveries by the product's partNumber
        const product = await this.productModel.findById(oid).select('partNumber').lean().exec();
        if (!product?.partNumber) return [] as DiscoveryAppDocument[];

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

        return fallback.map((doc) => this.toDiscoveryAppDocument(doc as any));
    }

    private toDiscoveryAppDocument(doc: any): DiscoveryAppDocument {
        const finalPayload = (doc?.final && typeof doc.final === 'object') ? doc.final : (doc?.data ?? {});
        const sources = (doc?.sources && typeof doc.sources === 'object') ? doc.sources : {};
        const mlSource = (sources?.mercadolivre && typeof sources.mercadolivre === 'object') ? sources.mercadolivre : {};
        const serpSource = (sources?.serp && typeof sources.serp === 'object') ? sources.serp : {};

        const rawVehicles = Array.isArray(finalPayload?.vehicles) ? finalPayload.vehicles : [];
        const vehicles: DiscoveryVehicleSuggestion[] = rawVehicles
            .map((v: any) => {
                if (typeof v === 'string') return { label: v.trim() };
                if (v && typeof v === 'object') {
                    const label = v.label ?? [v.brand, v.model].filter(Boolean).join(' ').trim();
                    if (label) return { label };
                }
                return null;
            })
            .filter((v: DiscoveryVehicleSuggestion | null): v is DiscoveryVehicleSuggestion => !!v && !!v.label);

        const breadcrumbPath = String(finalPayload?.breadcrumb ?? finalPayload?.breadcrumbPath ?? finalPayload?.breadCrumbPath ?? '');
        const categoryPath = finalPayload?.categoryPath ?? (breadcrumbPath || null);

        const rawAttributes = Array.isArray(finalPayload?.attributes) ? finalPayload.attributes : [];
        const attributes = rawAttributes
            .map((a: any) => ({
                id: typeof a?.id === 'string' ? a.id : undefined,
                key: String(a?.key ?? a?.name ?? '').trim(),
                value: String(a?.value ?? a?.value_name ?? '').trim(),
            }))
            .filter((a: { key: string; value: string }) => !!a.key && !!a.value);

        const data: DiscoveryAppData = {
            titles: Array.isArray(finalPayload?.titles) ? finalPayload.titles : [],
            prices: finalPayload?.prices ?? null,
            description: String(finalPayload?.description ?? ''),
            details: String(finalPayload?.details ?? ''),
            attributes,
            oemCodes: Array.isArray(finalPayload?.oemCodes) ? finalPayload.oemCodes : [],
            vehicles,
            categoryPath: categoryPath ? String(categoryPath) : null,
            breadcrumbPath,
            suggestedImages: Array.isArray(finalPayload?.suggestedImages) ? finalPayload.suggestedImages : [],
            winningSource: finalPayload?.preferredSource === 'mercadolivre' || finalPayload?.preferredSource === 'serp'
                ? finalPayload.preferredSource
                : null,
            confidence: finalPayload?.confidence ? String(finalPayload.confidence) : null,
            partNumber: String(finalPayload?.partNumber ?? doc?.partNumberNorm ?? ''),
            rawItems: Array.isArray(mlSource?.items)
                ? mlSource.items
                : (Array.isArray(serpSource?.items) ? serpSource.items : []),
            resolvedCategoryId: doc?.resolvedCategoryId ? String(doc.resolvedCategoryId) : null,
            timing: finalPayload?.timing ?? null,
        };

        return {
            id: String(doc?._id),
            _discoveryId: String(doc?._id),
            batchId: String(doc?.batchId ?? ''),
            query: String(doc?.query ?? ''),
            status: String(doc?.status ?? 'pending') as DiscoveryAppDocument['status'],
            intentVersion: Number(doc?.intentVersion ?? 1),
            isActiveIntent: !!doc?.isActiveIntent,
            createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
            error: doc?.error ?? null,
            data,
        };
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

