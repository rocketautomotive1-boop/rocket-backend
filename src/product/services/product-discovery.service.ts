import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../../queue/schemas/queue-record.schema';
import { ProductDiscoveryDocument, ProductDiscoveryModel } from '../schemas/product-discovery.schema';
import { Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';
import { GoogleSerpDiscoveryAdapter, WebImageResult } from '../../marketplace/adapters/google/google-serp-discovery.adapter';
import { computeDiscoveryDedupFields } from '../utils/discovery-dedup.util';

@Injectable()
export class ProductDiscoveryService {
    private readonly logger = new Logger(ProductDiscoveryService.name);

    constructor(
        @InjectModel(QueueRecordModel.name)
        private readonly queueModel: Model<QueueRecordDocument>,
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
        @InjectModel('ProductModel')
        private readonly productModel: Model<any>,
        private readonly amqpConnection: AmqpConnection,
        private readonly serpAdapter: GoogleSerpDiscoveryAdapter,
    ) { }

    async startDiscovery(params: {
        partNumber: string;
        brand?: string;
        isGenuine?: boolean;
        productId?: string;
        brandId?: string;
        userId?: string;
        force?: boolean;
    }): Promise<string> {
        const jobId = uuidv4();
        const { partNumber, brand, isGenuine, productId } = params;

        const dedup = computeDiscoveryDedupFields({ partNumber, brand, isGenuine });
        const { partNumberNorm, brandNorm } = dedup;

        // Discovery Logic: Se isGenuine for true, busca por partNumber. Caso contrário, partNumber + brand.
        const query = isGenuine ? partNumber : `${partNumber} ${brand || ''}`.trim();

        if (!params.force) {
            // Guard 1: produto já tem discovery por productId
            if (productId) {
                const existing = await this.discoveryModel.findOne({
                    productId: new Types.ObjectId(productId),
                    status: { $in: ['done', 'pending', 'processing'] },
                }).sort({ createdAt: -1 }).lean().exec();

                if (existing?.batchId) {
                    this.logger.log(
                        `Discovery skipped for product ${productId} — already has discovery ${existing._id} (status: ${existing.status})`,
                    );
                    await this.linkProductIdToDiscoveryIfNeeded(existing._id, productId, params.brandId);
                    return existing.batchId;
                }
            }

            // Guard 2: mesmo PN+marca (dedup) — documento concluído
            const existingByKey = await this.discoveryModel.findOne({
                partNumberNorm,
                brandNorm,
                isGenuine: dedup.isGenuine,
                status: 'done',
            }).sort({ createdAt: -1 }).lean().exec();

            if (existingByKey?.batchId) {
                this.logger.log(
                    `Discovery skipped — reuse done discovery ${existingByKey._id} for PN+brand key (${partNumberNorm} / ${brandNorm || '(genuine)'})`,
                );
                await this.linkProductIdToDiscoveryIfNeeded(existingByKey._id, productId, params.brandId);
                return existingByKey.batchId;
            }

            // Guard 3: job já pendente/processando na fila (mesma chave)
            const inflight = await this.queueModel.findOne({
                type: 'product.discovery',
                status: { $in: ['pending', 'processing'] },
                'metadata.partNumberNorm': partNumberNorm,
                'metadata.brandNorm': brandNorm,
                'metadata.isGenuine': dedup.isGenuine,
            }).sort({ createdAt: -1 }).lean().exec();

            if (inflight?.metadata?.jobId) {
                this.logger.log(
                    `Discovery skipped — reuse in-flight queue job ${inflight.metadata.jobId} for same PN+brand key`,
                );
                return inflight.metadata.jobId as string;
            }
        }

        this.logger.log(`Starting discovery for jobId: ${jobId}, query: ${query}, productId: ${productId}`);

        const record = new this.queueModel({
            type: 'product.discovery',
            status: 'pending',
            priority: 1,
            productId,
            metadata: {
                jobId,
                query,
                partNumber,
                brand,
                isGenuine,
                partNumberNorm,
                brandNorm,
                productId,
                brandId: params.brandId,
                userId: params.userId,
            },
        });

        await record.save();

        await this.amqpConnection.publish('rocket.inventory', 'product.discovery.request', {
            jobId,
            query,
            queueRecordId: record._id,
            productId,
            partNumber,
            brand,
            isGenuine,
            brandId: params.brandId,
        });

        return jobId;
    }

    private async linkProductIdToDiscoveryIfNeeded(
        discoveryDocId: Types.ObjectId | string,
        productId: string | undefined,
        brandId: string | undefined,
    ): Promise<void> {
        if (!productId) return;
        const pid = new Types.ObjectId(productId);
        const set: Record<string, unknown> = {};
        const doc = await this.discoveryModel.findById(discoveryDocId).select('productId brandId').lean().exec();
        if (!doc) return;
        if (!doc.productId) {
            set.productId = pid;
        }
        if (brandId && Types.ObjectId.isValid(brandId) && !(doc as { brandId?: Types.ObjectId }).brandId) {
            set.brandId = new Types.ObjectId(brandId);
        }
        if (Object.keys(set).length > 0) {
            await this.discoveryModel.updateOne({ _id: discoveryDocId }, { $set: set }).exec();
            this.logger.log(`Linked discovery ${discoveryDocId} → product ${productId}`);
        }
    }

    async getStatus(jobId: string) {
        const record = await this.queueModel.findOne({ 'metadata.jobId': jobId }).exec();
        if (record) {
            return {
                jobId: record.metadata.jobId,
                status: record.status.toUpperCase(), // PENDING, PROCESSING, COMPLETED, FAILED
                data: record.result,
                error: record.error,
                updatedAt: record.updatedAt,
            };
        }

        const fromDiscovery = await this.discoveryModel.findOne({ batchId: jobId }).lean().exec();
        if (fromDiscovery && fromDiscovery.status === 'done' && fromDiscovery.data) {
            const completedResult = {
                ...fromDiscovery.data,
                rawItems: fromDiscovery.rawItems || [],
                _discoveryId: String(fromDiscovery._id),
            };
            return {
                jobId,
                status: 'COMPLETED',
                data: completedResult,
                error: undefined,
                updatedAt: (fromDiscovery as { updatedAt?: Date }).updatedAt,
            };
        }

        return { status: 'NOT_FOUND' };
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

    async searchImages(query: string): Promise<WebImageResult[]> {
        return this.serpAdapter.searchImages(query);
    }

    async findByPartNumberAndBrand(
        partNumber: string,
        brandId?: string,
    ): Promise<ProductDiscoveryModel | null> {
        const partNumberNorm = partNumber.trim().toUpperCase();

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
