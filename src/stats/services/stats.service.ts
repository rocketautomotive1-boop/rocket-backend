import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../../product/schemas/product.schema';
import { StockMovementModel, StockMovementDocument } from '../../stock/schemas/stock-movement.schema';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class StatsService {
    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>,
        @InjectModel('AllocationModel') private allocationModel: Model<any>,
    ) { }

    /**
     * Calcula o valor do inventário filtrado por metadados de alocação (andar, sala, etc.).
     *
     * Fluxo:
     *  1. Busca alocações que correspondem aos filtros de metadata
     *  2. Extrai todos os productIds das caixas (boxes) dessas alocações
     *  3. Agrega movimentações de estoque desses produtos: totalValue = sum(price * quantity)
     */
    async getInventoryValueByAllocation(filters: Record<string, any>) {
        try {
            // --- 1. Montar filtro de alocação por metadata ---
            const allocationMatch: any = {};
            for (const [key, value] of Object.entries(filters)) {
                if (value != null && value !== '') {
                    allocationMatch[`metadata.${key}`] = String(value);
                }
            }

            // --- 2. Buscar alocações e extrair productIds das boxes ---
            const allocations = await this.allocationModel.find(allocationMatch).exec();

            if (allocations.length === 0) {
                return { totalValue: 0, totalQuantity: 0, productCount: 0 };
            }

            // Coletar todos os productIds únicos das boxes de todas as alocações
            const productIdSet = new Set<string>();
            for (const alloc of allocations) {
                if (alloc.boxes && Array.isArray(alloc.boxes)) {
                    for (const box of alloc.boxes) {
                        if (box.products && Array.isArray(box.products)) {
                            for (const pid of box.products) {
                                productIdSet.add(pid.toString());
                            }
                        }
                    }
                }
            }

            const productIds = Array.from(productIdSet).map(id => new Types.ObjectId(id));
            console.log(productIds)

            if (productIds.length === 0) {
                return { totalValue: 0, totalQuantity: 0, productCount: 0 };
            }

            // --- 3. Agregar movimentações para esses produtos ---
            // Nota: no banco, o campo é "product" (ObjectId), não "productId"
            const result = await this.stockMovementModel.aggregate([
                {
                    $match: {
                        productId: { $in: productIds },
                        price: { $exists: true },
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalValue: {
                            $sum: {
                                $multiply: ['$quantity', { $toDouble: { $ifNull: ['$price', 0] } }]
                            }
                        },
                        totalQuantity: { $sum: '$quantity' },
                        products: { $addToSet: '$productId' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        totalValue: 1,
                        totalQuantity: 1,
                        productCount: { $size: '$products' }
                    }
                }
            ]);

            return result[0] || { totalValue: 0, totalQuantity: 0, productCount: 0 };
        } catch (error) {
            console.error('Erro ao buscar valor de estoque por alocação:', error);
            throw error;
        }
    }

    // ----------------------------------------------------------------
    // Métodos auxiliares e existentes
    // ----------------------------------------------------------------

    resolveUserIdFromRequest(req: any): number {
        const userId = req?.user?.id || req?.user?.sub;
        if (!userId) {
            throw new BadRequestException('UserId não encontrado no token');
        }
        return Number(userId);
    }

    async getWeeklyPublishedProducts(userId?: number) {
        try {
            const endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            const startDate = new Date(endDate);
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() - 6);

            const matchStage: any = {
                externalId: { $exists: true, $ne: '' },
            };

            const pipeline: any[] = [
                { $match: matchStage },
                {
                    $group: {
                        _id: '$productId',
                        firstPublishedAt: { $min: '$lastSyncAt' }
                    }
                },
                {
                    $match: {
                        firstPublishedAt: { $gte: startDate, $lte: endDate }
                    }
                }
            ];

            const publishedProducts = await this.listingModel.aggregate(pipeline);

            const resultByDate: Record<string, number> = {};

            const toDateKey = (d: Date) => {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            for (const row of publishedProducts) {
                if (!row.firstPublishedAt) continue;
                const dateObj = new Date(row.firstPublishedAt);
                const key = toDateKey(dateObj);
                resultByDate[key] = (resultByDate[key] || 0) + 1;
            }

            const days: Array<{ date: string; day: string; count: number; today: boolean }> = [];
            const weekDaysSunFirst = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayKey = toDateKey(today);
            const cursor = new Date(startDate);
            cursor.setHours(0, 0, 0, 0);

            while (cursor <= endDate) {
                const key = toDateKey(cursor);
                const dayName = weekDaysSunFirst[cursor.getDay()];
                const isToday = key === todayKey;
                days.push({ date: key, day: dayName, count: resultByDate[key] ?? 0, today: isToday });
                cursor.setDate(cursor.getDate() + 1);
            }

            return days;
        } catch (error) {
            console.error('Erro ao buscar estatísticas semanais:', error);
            throw error;
        }
    }

    async getInventoryValue(period?: string, startDate?: string, endDate?: string, userId?: number) {
        try {
            let dateFilter: { start: Date; end: Date } | null = null;

            if (period) {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

                switch (period) {
                    case 'all':
                        dateFilter = null;
                        break;
                    case 'today':
                        dateFilter = {
                            start: new Date(today),
                            end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                        };
                        break;
                    case 'yesterday':
                        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                        dateFilter = {
                            start: yesterday,
                            end: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000 - 1)
                        };
                        break;
                    case 'last7days':
                        dateFilter = {
                            start: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000),
                            end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                        };
                        break;
                    case 'last15days':
                        dateFilter = {
                            start: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000),
                            end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                        };
                        break;
                    case 'last30days':
                        dateFilter = {
                            start: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000),
                            end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
                        };
                        break;
                    case 'custom':
                        if (startDate && endDate) {
                            dateFilter = {
                                start: new Date(startDate + 'T00:00:00'),
                                end: new Date(endDate + 'T23:59:59')
                            };
                        }
                        break;
                }
            }

            const publishedProducts = await this.listingModel.aggregate([
                { $match: { externalId: { $exists: true, $ne: '' } } },
                { $group: { _id: '$productId' } }
            ]);

            const productIds = publishedProducts.map(p => p._id);

            if (productIds.length === 0) {
                return {
                    totalValue: 0,
                    totalQuantity: 0,
                    productCount: 0,
                    period: period || 'all',
                    dateRange: dateFilter ? { start: dateFilter.start, end: dateFilter.end } : null
                };
            }

            const matchStage: any = {
                productId: { $in: productIds },
                price: { $exists: true },
            };

            if (dateFilter) {
                matchStage.date = { $gte: dateFilter.start, $lte: dateFilter.end };
            }

            const result = await this.stockMovementModel.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: null,
                        totalValue: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$type', 'inbound'] },
                                    { $multiply: ['$quantity', { $toDouble: '$price' }] },
                                    { $multiply: [{ $multiply: ['$quantity', -1] }, { $toDouble: '$price' }] }
                                ]
                            }
                        },
                        totalQuantity: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$type', 'inbound'] },
                                    '$quantity',
                                    { $multiply: ['$quantity', -1] }
                                ]
                            }
                        },
                        products: { $addToSet: '$productId' }
                    }
                },
                {
                    $project: {
                        totalValue: 1,
                        totalQuantity: 1,
                        productCount: { $size: '$products' }
                    }
                }
            ]);

            const stats = result[0] || { totalValue: 0, totalQuantity: 0, productCount: 0 };

            return {
                totalValue: stats.totalValue || 0,
                totalQuantity: stats.totalQuantity || 0,
                productCount: stats.productCount || 0,
                period: period || 'all',
                dateRange: dateFilter ? { start: dateFilter.start, end: dateFilter.end } : null
            };

        } catch (error) {
            console.error('Erro ao buscar valor do estoque:', error);
            throw error;
        }
    }
}