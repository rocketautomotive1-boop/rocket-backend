import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductivityType, UserProductivity, UserProductivityDocument } from './schemas/user-productivity.schema';

@Injectable()
export class UserProductivityService {
    private readonly logger = new Logger(UserProductivityService.name);

    constructor(
        @InjectModel(UserProductivity.name) private userProductivityModel: Model<UserProductivityDocument>,
    ) { }

    async logActivity(
        userId: string,
        type: ProductivityType,
        data: {
            marketplaceId?: string | Types.ObjectId;
            productId?: string | Types.ObjectId;
            isError?: boolean;
            price?: number;
            [key: string]: any;
        }
    ) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let realUserId: Types.ObjectId | undefined;
            if (userId && userId !== 'system' && userId !== 'SYSTEM') {
                try {
                    realUserId = new Types.ObjectId(userId);
                } catch (e) { }
            }

            const entry = new this.userProductivityModel({
                userId: realUserId,
                date: today,
                type,
                marketplaceId: data.marketplaceId ? new Types.ObjectId(data.marketplaceId) : undefined,
                productId: data.productId ? new Types.ObjectId(data.productId) : undefined,
                isError: !!data.isError,
                data: {
                    ...data,
                    marketplaceId: data.marketplaceId ? new Types.ObjectId(data.marketplaceId) : undefined,
                    productId: data.productId ? new Types.ObjectId(data.productId) : undefined,
                    timestamp: new Date()
                }
            });

            await entry.save();
        } catch (error) {
            this.logger.error(`Failed to log productivity for user ${userId}: ${error.message}`, error.stack);
        }
    }

    async getStats(userId: string, period: string = 'today') {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let dateMatch: any = today;

        if (period === 'yesterday') {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            dateMatch = yesterday;
        } else if (period === 'last7days') {
            const past = new Date(today);
            past.setDate(past.getDate() - 7);
            dateMatch = { $gte: past, $lte: today };
        } else if (period === 'last30days') {
            const past = new Date(today);
            past.setDate(past.getDate() - 30);
            dateMatch = { $gte: past, $lte: today };
        } else if (period === 'all') {
            dateMatch = undefined;
        }

        let userObjId: Types.ObjectId;
        try {
            userObjId = new Types.ObjectId(userId);
        } catch (e) {
            return {
                period,
                summary: { created: 0, publishedValue: 0, publishedQuantity: 0, syncSuccess: 0, syncErrors: 0, syncTotal: 0 },
                byMarketplace: []
            };
        }

        const matchStage: any = { userId: userObjId };
        if (dateMatch !== undefined) {
            matchStage.date = dateMatch;
        }

        const stats = await this.userProductivityModel.aggregate([
            {
                $match: matchStage
            },
            {
                $group: {
                    _id: {
                        productId: "$productId",
                        docId: { $cond: [{ $ifNull: ["$productId", false] }, null, "$_id"] }
                    },
                    createdCount: {
                        $max: { $cond: [{ $eq: ["$type", ProductivityType.CREATE] }, 1, 0] }
                    },
                    syncSuccess: {
                        $max: { $cond: [{ $eq: ["$type", ProductivityType.SYNC_SUCCESS] }, 1, 0] }
                    },
                    publishedValue: {
                        $max: {
                            $cond: [
                                { $eq: ["$type", ProductivityType.SYNC_SUCCESS] },
                                {
                                    $multiply: [
                                        { $ifNull: ["$data.price", 0] },
                                        { $ifNull: ["$data.quantity", 1] }
                                    ]
                                },
                                0
                            ]
                        }
                    },
                    errorsCount: {
                        $sum: { $cond: [{ $eq: ["$isError", true] }, 1, 0] }
                    },
                    totalSyncAttempts: {
                        $sum: {
                            $cond: [
                                { $in: ["$type", [ProductivityType.SYNC_SUCCESS, ProductivityType.SYNC_ERROR]] },
                                1,
                                0
                            ]
                        }
                    },
                    publishedQuantity: {
                        $max: {
                            $cond: [
                                { $eq: ["$type", ProductivityType.SYNC_SUCCESS] },
                                { $ifNull: ["$data.quantity", 0] },
                                0
                            ]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    createdCount: { $sum: "$createdCount" },
                    syncSuccessCount: { $sum: "$syncSuccess" },
                    publishedValue: { $sum: "$publishedValue" },
                    errorsCount: { $sum: "$errorsCount" },
                    totalSyncAttempts: { $sum: "$totalSyncAttempts" },
                    publishedQuantity: { $sum: "$publishedQuantity" }
                }
            }
        ]);

        const marketStatsMatchStage: any = {
            userId: userObjId,
            type: { $in: [ProductivityType.SYNC_SUCCESS, ProductivityType.SYNC_ERROR] }
        };
        if (dateMatch !== undefined) {
            marketStatsMatchStage.date = dateMatch;
        }

        // Error rate by marketplace
        const marketStats = await this.userProductivityModel.aggregate([
            {
                $match: marketStatsMatchStage
            },
            {
                $group: {
                    _id: "$marketplaceId",
                    errors: { $sum: { $cond: [{ $eq: ["$isError", true] }, 1, 0] } },
                    total: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: "marketplaces",
                    localField: "_id",
                    foreignField: "_id",
                    as: "marketplace"
                }
            },
            {
                $project: {
                    marketplaceName: { $arrayElemAt: ["$marketplace.name", 0] },
                    errors: 1,
                    total: 1,
                    errorRate: { $multiply: [{ $divide: ["$errors", "$total"] }, 100] }
                }
            }
        ]);

        const result = stats[0] || { createdCount: 0, syncSuccessCount: 0, publishedValue: 0, publishedQuantity: 0, errorsCount: 0, totalSyncAttempts: 0 };

        return {
            period,
            summary: {
                created: result.createdCount,
                publishedValue: result.publishedValue,
                publishedQuantity: result.publishedQuantity,
                syncSuccess: result.syncSuccessCount,
                syncErrors: result.errorsCount,
                syncTotal: result.totalSyncAttempts
            },
            byMarketplace: marketStats
        };
    }

    async getWeeklyStats(userId: string) {
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - 6);

        let userObjId: Types.ObjectId;
        try {
            userObjId = new Types.ObjectId(userId);
        } catch (e) {
            return [];
        }

        const stats = await this.userProductivityModel.aggregate([
            {
                $match: {
                    userId: userObjId,
                    date: { $gte: startDate, $lte: endDate },
                    type: ProductivityType.SYNC_SUCCESS
                }
            },
            {
                $group: {
                    _id: {
                        date: "$date",
                        productId: "$productId"
                    }
                }
            },
            {
                $group: {
                    _id: "$_id.date",
                    count: { $sum: 1 }
                }
            }
        ]);

        const resultByDate: Record<string, number> = {};
        const toDateKey = (d: Date) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        for (const row of stats) {
            if (!row._id) continue;
            const dateObj = new Date(row._id);
            const key = toDateKey(dateObj);
            resultByDate[key] = (resultByDate[key] || 0) + row.count;
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
    }
}
