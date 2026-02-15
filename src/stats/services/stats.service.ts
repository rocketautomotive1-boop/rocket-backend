
import { Injectable, BadRequestException } from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../../product/schemas/product.schema';
import { StockMovementModel, StockMovementDocument } from '../../product/schemas/stock-movement.schema';

import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class StatsService {
    constructor(
        @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
        @InjectModel(StockMovementModel.name) private stockMovementModel: Model<StockMovementDocument>,
        @InjectModel(ListingModel.name) private listingModel: Model<ListingDocument>, // [NEW] Injected ListingModel
    ) { }

    /**
     * Obtém o userId a partir do token (req.user) e garante que esteja presente.
     * Caso não exista, lança BadRequest para evitar consultas sem filtro de usuário.
     */
    resolveUserIdFromRequest(req: any): number {
        const userId = req?.user?.id || req?.user?.sub;
        if (!userId) {
            throw new BadRequestException('UserId não encontrado no token');
        }
        return Number(userId);
    }

    async getWeeklyPublishedProducts(userId?: number) {
        try {
            // Calcular intervalo de datas (últimos 7 dias) desconsiderando a hora
            const endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            const startDate = new Date(endDate);
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() - 6); // inclui hoje + 6 dias anteriores

            // Aggregation pipeline on LISTING model
            // 1. Match active/synced listings with externalId
            // 2. Filter by date range

            const matchStage: any = {
                externalId: { $exists: true, $ne: '' },
                // status: 'active' // Optional: if we only want active ones
            };

            const pipeline: any[] = [
                { $match: matchStage },
                {
                    $group: {
                        _id: '$productId', // Group by product (count product once even if multiple listings)
                        firstPublishedAt: { $min: '$lastSyncAt' } // Use lastSyncAt from listing
                    }
                },
                {
                    $match: {
                        firstPublishedAt: { $gte: startDate, $lte: endDate }
                    }
                }
            ];

            const publishedProducts = await this.listingModel.aggregate(pipeline);

            // Agrupar as contagens pela data da primeira publicação
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
                // Ajustar para o timezone local se necessário
                // dateObj.setHours(dateObj.getHours() - 3); 

                const key = toDateKey(dateObj);
                if (!resultByDate[key]) {
                    resultByDate[key] = 0;
                }
                resultByDate[key]++;
            }

            // Construir série contínua de 7 dias usando apenas a data
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

            // Calcular filtro de data baseado no período
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

            // Aggregation on StockMovementModel
            // 1. Match published products? Logic says "Buscar IDs de produtos publicados".
            // ProductTitle check is needed to filter valid products first.
            // But we can just aggregation distinct match?

            // Step 1: Get published product Ids using aggregation on ListingModel
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

            // Step 2: Aggregate StockMovements
            const matchStage: any = {
                product: { $in: productIds },
                price: { $exists: true }, // price > 0 check handled below or in match?
            };

            // Handling price check: Mongo Decimal128 > 0
            // Can be done in $expr or simpler check if we assume price is positive if exists.

            if (dateFilter) {
                matchStage.date = { $gte: dateFilter.start, $lte: dateFilter.end }; // Using 'date' field from StockMovementModel
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
                        products: { $addToSet: '$product' }
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