import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CartModel, CartDocument } from './schemas/cart.schema';

@Injectable()
export class CartCleanupService {
    private readonly logger = new Logger(CartCleanupService.name);

    constructor(
        @InjectModel(CartModel.name)
        private cartModel: Model<CartDocument>,
    ) { }

    @Cron(CronExpression.EVERY_HOUR)
    async handleCron() {
        this.logger.debug('Running Cart Cleanup...');

        // 24 hours ago
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const result = await this.cartModel.updateMany(
            {
                status: 'active',
                updatedAt: { $lt: cutoff }
            },
            {
                $set: { status: 'abandoned' }
            }
        );

        if (result.modifiedCount > 0) {
            this.logger.log(`Marked ${result.modifiedCount} carts as abandoned.`);
        }
    }
}
