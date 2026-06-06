import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { ProductDocument, ProductModel } from '../../product/schemas/product.schema';

const DEFAULT_BREAKDOWN_LIMIT = 50;
const MAX_BREAKDOWN_LIMIT = 200;

interface CreatedInventorySummary {
    productCount: number;
    productsWithStock: number;
    totalQuantity: number;
    totalValue: number;
}

@Injectable()
export class CreatedInventoryValueService {
    constructor(
        @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    ) {}

    async getForCreator(userId: string, requestedLimit?: number) {
        const creatorId = this.parseCreatorId(userId);
        const limit = this.normalizeLimit(requestedLimit);
        const [result] = await this.productModel.aggregate(this.buildPipeline(creatorId, limit));
        return this.toResponse(userId, limit, result);
    }

    private parseCreatorId(userId: string): Types.ObjectId {
        if (!Types.ObjectId.isValid(userId)) {
            throw new BadRequestException('Invalid authenticated user id');
        }
        return new Types.ObjectId(userId);
    }

    private normalizeLimit(value?: number): number {
        const raw = value ?? DEFAULT_BREAKDOWN_LIMIT;
        if (!Number.isFinite(raw) || raw < 0) {
            throw new BadRequestException('limit must be a positive number');
        }
        return Math.min(Math.floor(raw), MAX_BREAKDOWN_LIMIT);
    }

    private buildPipeline(creatorId: Types.ObjectId, limit: number): PipelineStage[] {
        return [
            this.matchCreatedProducts(creatorId),
            this.lookupCurrentStock(),
            ...this.projectCurrentValue(),
            this.facetSummaryAndBreakdown(limit),
        ];
    }

    private matchCreatedProducts(creatorId: Types.ObjectId): PipelineStage.Match {
        return { $match: { createdByUserId: creatorId, active: { $ne: false } } };
    }

    private lookupCurrentStock(): PipelineStage.Lookup {
        return {
            $lookup: {
                from: 'stock_movements',
                let: { productId: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$productId', '$$productId'] } } },
                    this.groupStockByProduct(),
                ],
                as: 'stock',
            },
        };
    }

    private groupStockByProduct(): PipelineStage.Group {
        return {
            $group: {
                _id: '$productId',
                total: { $sum: this.stockDeltaExpression() },
            },
        };
    }

    private stockDeltaExpression(): Record<string, unknown> {
        return {
            $switch: {
                branches: [
                    { case: { $in: ['$type', ['inbound', 'purchase_return']] }, then: '$quantity' },
                    { case: { $in: ['$type', ['outbound', 'sale', 'transfer']] }, then: { $multiply: ['$quantity', -1] } },
                    { case: { $eq: ['$type', 'adjustment'] }, then: '$quantity' },
                ],
                default: 0,
            },
        };
    }

    private projectCurrentValue(): PipelineStage[] {
        return [
            {
                $addFields: {
                    rawStockQuantity: { $ifNull: [{ $arrayElemAt: ['$stock.total', 0] }, 0] },
                    currentPrice: { $toDouble: { $ifNull: ['$price', 0] } },
                },
            },
            {
                $addFields: {
                    stockQuantity: { $max: ['$rawStockQuantity', 0] },
                    currentValue: { $multiply: [{ $max: ['$rawStockQuantity', 0] }, '$currentPrice'] },
                },
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    partNumber: 1,
                    brand: '$brand.name',
                    currentPrice: 1,
                    stockQuantity: 1,
                    rawStockQuantity: 1,
                    currentValue: 1,
                },
            },
        ];
    }

    private facetSummaryAndBreakdown(limit: number): PipelineStage.Facet {
        return {
            $facet: {
                summary: [
                    {
                        $group: {
                            _id: null,
                            productCount: { $sum: 1 },
                            productsWithStock: { $sum: { $cond: [{ $gt: ['$stockQuantity', 0] }, 1, 0] } },
                            totalQuantity: { $sum: '$stockQuantity' },
                            totalValue: { $sum: '$currentValue' },
                        },
                    },
                    { $project: { _id: 0 } },
                ],
                products: [
                    { $sort: { currentValue: -1, name: 1 } },
                    { $limit: limit },
                ],
            },
        };
    }

    private toResponse(userId: string, limit: number, result: any) {
        const summary = this.extractSummary(result);
        return {
            userId,
            generatedAt: new Date().toISOString(),
            productBreakdownLimit: limit,
            ...summary,
            hasMoreProducts: summary.productCount > limit,
            products: result?.products || [],
        };
    }

    private extractSummary(result: any): CreatedInventorySummary {
        return result?.summary?.[0] || {
            productCount: 0,
            productsWithStock: 0,
            totalQuantity: 0,
            totalValue: 0,
        };
    }
}
