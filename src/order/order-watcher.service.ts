import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderModel, OrderDocument } from './schemas/order.schema';
import { OrderService } from './order.service';

@Injectable()
export class OrderWatcherService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(OrderWatcherService.name);
    private changeStream: any; // ChangeStream type from mongodb driver
    private processingOrders = new Set<string>(); // Prevent duplicate processing

    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly orderService: OrderService
    ) { }

    async onModuleInit() {
        this.logger.log('🔍 Starting Order Change Stream Watcher...');

        try {
            // Watch for insert and update operations on orders collection
            this.changeStream = this.orderModel.watch(
                [
                    {
                        $match: {
                            operationType: { $in: ['insert', 'update'] },
                            // Only watch for orders that haven't been synced yet
                            $or: [
                                { 'fullDocument.syncedAt': null },
                                { 'fullDocument.syncedAt': { $exists: false } }
                            ]
                        }
                    }
                ],
                { fullDocument: 'updateLookup' }
            );

            this.changeStream.on('change', async (change: any) => {
                await this.handleOrderChange(change);
            });

            this.changeStream.on('error', (error) => {
                this.logger.error(`Change Stream error: ${error.message}`);
            });

            this.logger.log('✅ Order Change Stream Watcher started successfully');
        } catch (error) {
            this.logger.error(`Failed to start Change Stream: ${error.message}`);
            this.logger.warn('Order auto-sync will not work. Check MongoDB Replica Set configuration.');
        }
    }

    async onModuleDestroy() {
        this.logger.log('Stopping Order Change Stream Watcher...');
        if (this.changeStream) {
            await this.changeStream.close();
        }
    }

    private async handleOrderChange(change: any) {
        const order = change.fullDocument;

        if (!order) {
            this.logger.warn('Change event without fullDocument');
            return;
        }

        const orderId = order._id.toString();
        const externalId = order.externalId;

        // Debounce: Skip if already processing this order
        if (this.processingOrders.has(orderId)) {
            this.logger.debug(`Order ${externalId} is already being processed. Skipping.`);
            return;
        }

        // Skip if already synced
        if (order.syncedAt) {
            this.logger.debug(`Order ${externalId} is already synced. Skipping.`);
            return;
        }

        this.logger.log(`📦 Detected unsynced order: ${externalId} (${change.operationType})`);

        // Mark as processing
        this.processingOrders.add(orderId);

        try {
            // Trigger automatic synchronization (Async)
            const result = await this.orderService.enqueueSyncOrder(
                externalId,
                order.marketplaceId.toString()
            );

            if (result.isSuccess) {
                this.logger.log(`✅ Auto-sync enqueued for order ${externalId}`);
            } else {
                this.logger.error(`❌ Failed to enqueue auto-sync for order ${externalId}: ${result.error}`);
            }
        } catch (error) {
            this.logger.error(`❌ Error auto-syncing order ${externalId}: ${error.message}`);
        } finally {
            // Remove from processing set after a delay to prevent immediate re-processing
            setTimeout(() => {
                this.processingOrders.delete(orderId);
            }, 5000); // 5 second cooldown
        }
    }

    /**
     * Manually trigger sync for a specific order (useful for retry)
     */
    async triggerSync(externalId: string, marketplaceId: string): Promise<void> {
        this.logger.log(`Manual sync trigger for order ${externalId}`);

        const result = await this.orderService.enqueueSyncOrder(externalId, marketplaceId);

        if (result.isFailure) {
            throw new Error(result.error);
        }
    }
}
