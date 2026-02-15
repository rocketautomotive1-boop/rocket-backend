import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { ProductModel, ProductDocument } from './schemas/product.schema';
import { StockMovementModel, StockMovementDocument } from './schemas/stock-movement.schema';
import { ProductCompatibilityModel, ProductCompatibilityDocument } from './schemas/product-compatibility.schema';

@Injectable()
export class ProductRepository {
    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
        @InjectModel(ProductCompatibilityModel.name) private productCompatibilityModel: Model<ProductCompatibilityDocument>,
        @InjectConnection() private readonly connection: Connection,
    ) { }

    getConnection(): Connection {
        return this.connection;
    }

    async bulkUpdateCategorySnapshot(categoryId: number, data: Partial<any>): Promise<number> {
        // Deprecated: Category is now referenced, so no snapshot update needed.
        return 0;
    }

    async bulkUpdateBrandSnapshot(brandId: number, data: Partial<any>): Promise<number> {
        const update: any = {};
        for (const [key, value] of Object.entries(data)) {
            update[`brand.${key}`] = value;
        }

        const result = await this.productModel.updateMany(
            { 'brand.id': brandId },
            { $set: update }
        ).exec();

        return result.modifiedCount;
    }

    private toDto(doc: any): ProductModel {
        if (!doc) return null;
        const obj = doc.toObject ? doc.toObject() : doc;

        const toStr = (val: any) => {
            if (val === null || val === undefined) return val;
            if (val instanceof Types.Decimal128 || val._bsontype === 'Decimal128') return val.toString();
            if (val.$numberDecimal) return val.$numberDecimal;
            return val;
        };

        const transformObject = (obj: any): any => {
            if (Array.isArray(obj)) return obj.map(transformObject);
            if (obj !== null && typeof obj === 'object') {
                if (obj instanceof Types.ObjectId) return obj.toString();
                if (obj instanceof Types.Decimal128 || obj._bsontype === 'Decimal128') return obj.toString();

                const newObj: any = {};
                for (const key of Object.keys(obj)) {
                    if (key === '_id') {
                        newObj[key] = obj[key].toString();
                        newObj['id'] = obj[key].toString();
                    } else {
                        newObj[key] = transformObject(obj[key]);
                    }
                }
                return newObj;
            }
            return obj;
        };

        const transformed = transformObject(obj);

        // Ensure root level decimal fields are strings
        const decimalFields = ['price', 'costPrice', 'weight'];
        decimalFields.forEach(field => {
            if (transformed[field]) transformed[field] = toStr(transformed[field]);
        });

        if (transformed.dimensions) {
            transformed.dimensions.length = toStr(transformed.dimensions.length);
            transformed.dimensions.width = toStr(transformed.dimensions.width);
            transformed.dimensions.height = toStr(transformed.dimensions.height);
        }

        return transformed as ProductModel;
    }

    async findById(id: string): Promise<ProductDocument | null> {
        return this.productModel.findById(id).populate({ path: 'category', populate: { path: 'ancestors' } }).exec();
    }

    async findByIdClean(id: string): Promise<ProductModel | null> {
        const doc = await this.findById(id);
        return this.toDto(doc);
    }

    async findBySku(sku: string | number): Promise<ProductDocument | null> {
        const query = typeof sku === 'number' ? { sku } : { partNumber: sku };
        return this.productModel.findOne(query).populate({ path: 'category', populate: { path: 'ancestors' } }).exec();
    }

    async findBySkuClean(sku: string | number): Promise<ProductModel | null> {
        const doc = await this.findBySku(sku);
        return this.toDto(doc);
    }

    async findAll(query: any = {}, options: any = {}): Promise<ProductDocument[]> {
        const { page = 1, limit = 50, sort = { createdAt: -1 } } = options;
        return this.productModel.find(query)
            .populate({ path: 'category', populate: { path: 'ancestors' } })
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .exec();
    }

    async findAllClean(query: any = {}, options: any = {}): Promise<ProductModel[]> {
        const docs = await this.findAll(query, options);
        return docs.map(doc => this.toDto(doc));
    }

    async findOne(query: any): Promise<ProductDocument | null> {
        return this.productModel.findOne(query).populate({ path: 'category', populate: { path: 'ancestors' } }).exec();
    }

    async findOneClean(query: any): Promise<ProductModel | null> {
        const doc = await this.findOne(query);
        return this.toDto(doc);
    }

    async findOneRaw(query: any): Promise<ProductDocument | null> {
        return this.productModel.findOne(query).exec();
    }

    async findAllRaw(query: any = {}, options: any = {}): Promise<ProductDocument[]> {
        const { page = 1, limit = 50, sort = { createdAt: -1 } } = options;
        return this.productModel.find(query)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .exec();
    }

    async create(data: any): Promise<ProductDocument> {
        const product = new this.productModel(data);
        return product.save();
    }

    async update(id: string, data: any): Promise<ProductDocument | null> {
        return this.productModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async save<T extends any>(doc: T, session?: ClientSession): Promise<T> {
        if ((doc as any).save) {
            return (doc as any).save({ session });
        }
        return doc;
    }

    async count(query: any = {}): Promise<number> {
        return this.productModel.countDocuments(query).exec();
    }

    // Stock Movement Methods
    async updateStock(productId: string | Types.ObjectId, quantity: number, session?: ClientSession): Promise<void> {
        const id = (typeof productId === 'string' && Types.ObjectId.isValid(productId)) ? new Types.ObjectId(productId) : productId;
        await this.productModel.updateOne({ _id: id as any }, { $inc: { stockQuantity: quantity } }, { session }).exec();
    }

    async updateStockReserved(productId: string | Types.ObjectId, quantity: number, session?: ClientSession): Promise<void> {
        const id = (typeof productId === 'string' && Types.ObjectId.isValid(productId)) ? new Types.ObjectId(productId) : productId;
        await this.productModel.updateOne({ _id: id as any }, { $inc: { stockReserved: quantity } }, { session }).exec();
    }

    async updatePrice(productId: string | Types.ObjectId, price: number, session?: ClientSession): Promise<void> {
        const id = (typeof productId === 'string' && Types.ObjectId.isValid(productId)) ? new Types.ObjectId(productId) : productId;
        await this.productModel.updateOne(
            { _id: id as any },
            { $set: { price: Types.Decimal128.fromString(price.toString()) } },
            { session }
        ).exec();
    }

    async calculateStock(productId: string, session?: ClientSession): Promise<number> {
        const id = new Types.ObjectId(productId);
        const aggregation = this.stockMovementModel.aggregate([
            { $match: { productId: id } },
            {
                $group: {
                    _id: '$productId',
                    total: {
                        $sum: {
                            $switch: {
                                branches: [
                                    { case: { $in: ['$type', ['inbound', 'purchase_return']] }, then: '$quantity' },
                                    { case: { $in: ['$type', ['outbound', 'sale', 'transfer']] }, then: { $multiply: ['$quantity', -1] } },
                                    { case: { $eq: ['$type', 'adjustment'] }, then: '$quantity' }
                                ],
                                default: 0
                            }
                        }
                    }
                }
            }
        ]);

        if (session) {
            aggregation.session(session);
        }

        const stats = await aggregation.exec();
        return stats.length > 0 ? stats[0].total : 0;
    }

    async syncStockFromMovements(productId: string, session?: ClientSession): Promise<number> {
        const actualStock = await this.calculateStock(productId, session);
        await this.productModel.updateOne({ _id: new Types.ObjectId(productId) as any }, { $set: { stockQuantity: actualStock } }, { session }).exec();
        return actualStock;
    }

    async findLatestMovementWithPrice(productId: string): Promise<StockMovementDocument | null> {
        const id = new Types.ObjectId(productId);
        return (this.stockMovementModel as any).findOne(
            { productId: id, price: { $ne: null } }
        ).sort({ date: -1 }).exec();
    }

    async findMovements(query: any, limit: number = 0): Promise<StockMovementDocument[]> {
        const mongoQuery: any = { ...query };
        // Map legacy 'product' query to 'productId'
        if (mongoQuery.product) {
            mongoQuery.productId = typeof mongoQuery.product === 'string' && Types.ObjectId.isValid(mongoQuery.product)
                ? new Types.ObjectId(mongoQuery.product) : mongoQuery.product;
            delete mongoQuery.product;
        }
        // Map 'reference' to 'metadata.externalReference'
        if (mongoQuery.reference) {
            mongoQuery['metadata.externalReference'] = mongoQuery.reference;
            delete mongoQuery.reference;
        }

        const q = this.stockMovementModel.find(mongoQuery).populate('productId', 'name partNumber sku').sort({ date: -1 });
        if (limit > 0) q.limit(limit);
        return q.exec();
    }

    async findMovementById(id: string): Promise<StockMovementDocument | null> {
        return this.stockMovementModel.findById(id).populate('productId', 'name partNumber sku').exec();
    }

    async createMovement(data: any, session?: ClientSession): Promise<StockMovementDocument> {
        const movementData = { ...data };
        if (movementData.product) {
            movementData.productId = movementData.product;
            delete movementData.product;
        }
        if (typeof movementData.productId === 'string' && Types.ObjectId.isValid(movementData.productId)) {
            movementData.productId = new Types.ObjectId(movementData.productId);
        }
        const movement = new this.stockMovementModel(movementData);
        return movement.save({ session });
    }

    async updateMovement(id: string, query: any, data: any): Promise<StockMovementDocument | null> {
        const mongoQuery: any = { ...query };
        if (mongoQuery.product) {
            mongoQuery.productId = mongoQuery.product;
            delete mongoQuery.product;
        }
        return this.stockMovementModel.findOneAndUpdate(
            { _id: id, ...mongoQuery },
            { $set: data },
            { new: true }
        ).exec();
    }

    async deleteMovement(id: string, session?: ClientSession): Promise<void> {
        await this.stockMovementModel.deleteOne({ _id: id }, { session }).exec();
    }

    async aggregateMovements(pipeline: any[]): Promise<any[]> {
        // Pipeline might explicitly use 'product' matching. Caller needs to check.
        // But for safety, we assume caller (ProductMovementService) will handle pipeline field names 
        // OR we can't easily auto-patch pipeline. 
        return this.stockMovementModel.aggregate(pipeline).exec();
    }

    async checkUniqueness(query: any): Promise<boolean> {
        const count = await this.productModel.countDocuments(query);
        return count === 0;
    }

    async existsMovementReference(reference: string): Promise<boolean> {
        const count = await this.stockMovementModel.countDocuments({ 'metadata.externalReference': reference });
        return count > 0;
    }

    async findMovementsByReferences(references: string[]): Promise<string[]> {
        console.log(`[ProductRepo] Finding movements for ${references.length} refs:`, references);
        const movements = await this.stockMovementModel.find({ 'metadata.externalReference': { $in: references } }, { 'metadata.externalReference': 1 }).exec();
        console.log(`[ProductRepo] Found ${movements.length} movements.`);
        return movements.map(m => m.metadata?.externalReference).filter(Boolean);
    }

    // Compatibility Methods
    async findCompatibilities(query: any): Promise<ProductCompatibilityDocument[]> {
        if (query.product && typeof query.product === 'string') {
            query.product = new Types.ObjectId(query.product);
        }
        return this.productCompatibilityModel.find(query).exec();
    }

    async existsCompatibility(query: any): Promise<boolean> {
        if (query.product && typeof query.product === 'string') {
            query.product = new Types.ObjectId(query.product);
        }
        const exists = await this.productCompatibilityModel.exists(query);
        return !!exists;
    }

    async deleteCompatibilities(query: any): Promise<void> {
        await this.productCompatibilityModel.deleteMany(query).exec();
    }

    async createCompatibility(data: any): Promise<ProductCompatibilityDocument> {
        const compatibility = new this.productCompatibilityModel(data);
        return compatibility.save();
    }

    async updateCompatibility(id: string, data: any): Promise<ProductCompatibilityDocument | null> {
        return this.productCompatibilityModel.findByIdAndUpdate(id, data, { new: true }).exec();
    }

    async calculateTotalSold(productId: string): Promise<number> {
        const id = new Types.ObjectId(productId);
        const result = await this.stockMovementModel.aggregate([
            {
                $match: {
                    productId: id,
                    type: { $in: ['outbound', 'sale'] }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$quantity' }
                }
            }
        ]);
        return result[0]?.total || 0;
    }

    async updateTotalSold(productId: string, quantity: number, session?: ClientSession): Promise<void> {
        const id = (typeof productId === 'string' && Types.ObjectId.isValid(productId)) ? new Types.ObjectId(productId) : productId;
        await this.productModel.updateOne({ _id: id as any }, { $inc: { totalSold: quantity } }, { session }).exec();
    }
}
