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

            let realUserId = userId;
            if (!realUserId || realUserId === 'system' || realUserId === 'SYSTEM') {
                // If we don't have a user, we might want to log it as 'SYSTEM' or skip
                // For now, logging as SYSTEM to debug
                realUserId = 'SYSTEM';
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
                    timestamp: new Date()
                }
            });

            await entry.save();
        } catch (error) {
            this.logger.error(`Failed to log productivity for user ${userId}: ${error.message}`, error.stack);
        }
    }

    async getStats(userId: string) {
        // Default to last 30 days or just today/all time? 
        // Request said "daily progress", let's show today's stats primarily but maybe return a structure that supports historical if needed using aggregation.
        // The requirements say "aggregated by userId and day".
        // The endpoint is "my-stats" so implies current snapshot or recent history.

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await this.userProductivityModel.aggregate([
            {
                $match: {
                    userId: userId,
                    date: today
                }
            },
            {
                $group: {
                    _id: null,
                    createdCount: {
                        $sum: { $cond: [{ $eq: ["$type", ProductivityType.CREATE] }, 1, 0] }
                    },
                    syncSuccessCount: {
                        $sum: { $cond: [{ $eq: ["$type", ProductivityType.SYNC_SUCCESS] }, 1, 0] }
                    },
                    publishedValue: {
                        $sum: {
                            $cond: [
                                { $eq: ["$type", ProductivityType.SYNC_SUCCESS] },
                                { $ifNull: ["$data.price", 0] },
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
                    }
                }
            }
        ]);

        // Error rate by marketplace
        const marketStats = await this.userProductivityModel.aggregate([
            {
                $match: {
                    userId: userId,
                    date: today,
                    type: { $in: [ProductivityType.SYNC_SUCCESS, ProductivityType.SYNC_ERROR] }
                }
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

        const result = stats[0] || { createdCount: 0, syncSuccessCount: 0, publishedValue: 0, errorsCount: 0, totalSyncAttempts: 0 };

        return {
            date: today,
            summary: {
                created: result.createdCount,
                publishedValue: result.publishedValue,
                syncSuccess: result.syncSuccessCount,
                syncErrors: result.errorsCount,
                syncTotal: result.totalSyncAttempts
            },
            byMarketplace: marketStats
        };
    }
}
