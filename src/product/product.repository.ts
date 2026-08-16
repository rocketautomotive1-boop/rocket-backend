import { Injectable } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { ProductModel, ProductDocument } from './schemas/product.schema';
import { ProductCompatibilityModel, ProductCompatibilityDocument } from './schemas/product-compatibility.schema';

@Injectable()
export class ProductRepository {
    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
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

    /** Mark a reserved image slot as failed (atomic positional update by slotId). */
    async markImageSlotFailed(productId: string, slotId: string): Promise<void> {
        await this.productModel.updateOne(
            { _id: productId, 'images.slotId': slotId },
            { $set: { 'images.$.status': 'failed' } },
        ).exec();
    }

    /** Mark an existing image slot as processing (atomic positional update by slotId). */
    async markImageSlotProcessing(productId: string, slotId: string): Promise<void> {
        await this.productModel.updateOne(
            { _id: productId, 'images.slotId': slotId },
            { $set: { 'images.$.status': 'processing' } },
        ).exec();
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

    /**
     * Minimal projection for badges/cards: only name + images, for a batch of ids.
     * Returns plain objects; the main image is resolved by the caller.
     */
    async findSummariesByIds(ids: string[]): Promise<Array<{ _id: any; name: string; images?: any[] }>> {
        const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
        if (validIds.length === 0) return [];
        return this.productModel
            .find({ _id: { $in: validIds } } as any)
            .select('name images')
            .lean()
            .exec() as any;
    }

    /**
     * Lighter document for list / initial load: no images, no draft blob, shallow category (no ancestors chain).
     */
    async findByIdLean(id: string): Promise<ProductDocument | null> {
        return this.productModel
            .findById(id)
            .select('-images -draftData')
            .populate({ path: 'category', select: 'name externalId _id path_from_root' })
            .exec();
    }

    async findByIdClean(id: string): Promise<ProductModel | null> {
        const doc = await this.findById(id);
        return this.toDto(doc);
    }

    async findByIdLeanClean(id: string): Promise<ProductModel | null> {
        const doc = await this.findByIdLean(id);
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

    // Stock movement/cost/reserved methods removed — stock is owned by StockModule.
    // Reads go through STOCK_QUERY_PORT; writes through StockService.

    async checkUniqueness(query: any): Promise<boolean> {
        const count = await this.productModel.countDocuments(query);
        return count === 0;
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

    // calculateTotalSold removed — derive from the stock ledger via StockQueryService if needed.

    async updateTotalSold(productId: string, quantity: number, session?: ClientSession): Promise<void> {
        const id = (typeof productId === 'string' && Types.ObjectId.isValid(productId)) ? new Types.ObjectId(productId) : productId;
        await this.productModel.updateOne({ _id: id as any }, { $inc: { totalSold: quantity } }, { session }).exec();
    }
}
