import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../../queue/schemas/queue-record.schema';
import { ProductDiscoveryDocument } from '../schemas/product-discovery.schema';
import { Types } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ProductDiscoveryService {
    private readonly logger = new Logger(ProductDiscoveryService.name);

    constructor(
        @InjectModel(QueueRecordModel.name)
        private readonly queueModel: Model<QueueRecordDocument>,
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<ProductDiscoveryDocument>,
        private readonly amqpConnection: AmqpConnection,
    ) { }

    async startDiscovery(params: {
        partNumber: string;
        brand?: string;
        isGenuine?: boolean;
        productId?: string;
        userId?: string;
    }): Promise<string> {
        const jobId = uuidv4();
        const { partNumber, brand, isGenuine, productId } = params;

        // Discovery Logic: Se isGenuine for true, busca por partNumber. Caso contrário, partNumber + brand.
        const query = isGenuine ? partNumber : `${partNumber} ${brand || ''}`.trim();

        this.logger.log(`Starting discovery for jobId: ${jobId}, query: ${query}, productId: ${productId}`);

        // Save initial state to MongoDB using QueueRecordModel
        // We'll use a specific type 'product.discovery'
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
                productId,
                userId: params.userId,
            },
        });

        await record.save();

        // Publish to RabbitMQ
        await this.amqpConnection.publish('rocket.inventory', 'product.discovery.request', {
            jobId,
            query,
            queueRecordId: record._id,
            productId,
        });

        return jobId;
    }

    async getStatus(jobId: string) {
        const record = await this.queueModel.findOne({ 'metadata.jobId': jobId }).exec();
        if (!record) {
            return { status: 'NOT_FOUND' };
        }

        return {
            jobId: record.metadata.jobId,
            status: record.status.toUpperCase(), // PENDING, PROCESSING, COMPLETED, FAILED
            data: record.result,
            error: record.error,
            updatedAt: record.updatedAt,
        };
    }

    async findByProductId(productId: string) {
        return this.discoveryModel.find({ productId: new Types.ObjectId(productId) })
            .sort({ createdAt: -1 })
            .exec();
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
}
