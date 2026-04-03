import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { OrderModel, OrderDocument } from './schemas/order.schema';

@Injectable()
export class OrderRepository {
    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        @InjectConnection() private readonly connection: Connection
    ) { }

    getConnection(): Connection {
        return this.connection;
    }

    async findById(id: string): Promise<OrderDocument | null> {
        return this.orderModel.findById(id).populate('fiscalDocuments').exec();
    }

    async findByExternalId(externalId: string, marketplaceId?: string): Promise<OrderDocument | null> {
        const query: any = { externalId };
        if (marketplaceId) query.marketplaceId = marketplaceId;
        return this.orderModel.findOne(query).populate('fiscalDocuments').exec();
    }



    async save(order: OrderDocument): Promise<OrderDocument> {
        return order.save();
    }

    async create(data: any): Promise<OrderDocument> {
        return new this.orderModel(data).save();
    }

    async updateOne(query: any, update: any, options?: any): Promise<any> {
        return this.orderModel.updateOne(query, update, options).exec();
    }

    async upsertBatch(orders: any[]): Promise<any> {
        const operations = orders.map(order => ({
            updateOne: {
                filter: { externalId: order.externalId },
                update: { $set: order },
                upsert: true
            }
        }));

        if (operations.length > 0) {
            return this.orderModel.bulkWrite(operations);
        }
        return { modifiedCount: 0 };
    }

    async findAll(offset: number, limit: number, search?: string): Promise<OrderDocument[]> {
        const filter: any = {};

        if (search) {
            const regex = new RegExp(search, 'i');
            filter.$or = [
                { externalId: regex },
                { 'customer.name': regex },
                { 'customer.email': regex },
                { 'items.title': regex }
            ];

            // If strictly numeric (or ObjectId-like), can search additional fields if needed, 
            // but regex on string fields covers most.
            // Note: _id search requires casting to ObjectId, usually externalId is enough.
        }

        return this.orderModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .populate('fiscalDocuments')
            .populate({ path: 'items.productId', select: 'partNumber' })
            .exec();
    }

    async findOneAndUpdate(query: any, update: any, options?: any): Promise<OrderDocument | null> {
        return this.orderModel.findOneAndUpdate(query, update, {
            ...options,
            new: true // Return the updated document
        }).populate('fiscalDocuments').exec() as any;
    }
    async findExistingExternalIds(externalIds: string[]): Promise<any[]> {
        return this.orderModel.find(
            { externalId: { $in: externalIds } },
            { externalId: 1, syncedAt: 1, marketplaceId: 1, status: 1 }
        ).exec();
    }
}
