import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '../queue/queue.service';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly queueService: QueueService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        @Inject(forwardRef(() => MarketplaceAuthService))
        private readonly marketplaceAuthService: MarketplaceAuthService,
    ) { }

    // Every 10 Minutes: Refresh tokens that are about to expire (Proactive Refresh)
    @Cron('0 */10 * * * *')
    async handleTokenRefresh() {
        this.logger.log('Starting Scheduled Token Refresh Check...');
        try {
            const count = await this.marketplaceAuthService.refreshExpiringTokens();
            if (count > 0) {
                this.logger.log(`Proactive Refresh: ${count} tokens refreshed.`);
            } else {
                this.logger.log('Proactive Refresh: No tokens needing refresh.');
            }
        } catch (error) {
            this.logger.error('Error in Scheduled Token Refresh:', error);
        }
    }

    // Hourly Sync: Orders (Safety Net for missed webhooks)
    @Cron(CronExpression.EVERY_HOUR)
    async handleCronOrdersSync() {
        this.logger.log('Starting Hourly Orders Sync Job...');

        try {
            // Create a background job for syncing orders from all marketplaces
            // We push a 'orders-sync' job to the queue to avoid blocking the scheduler
            const marketplaces = await this.marketplaceRegistry.findAll();
            const activeMarketplaces = marketplaces.filter(mp => mp.enabled);

            if (activeMarketplaces.length === 0) {
                this.logger.log('No active marketplaces to sync.');
                return;
            }

            for (const mp of activeMarketplaces) {
                await this.queueService.addToQueue({
                    type: 'orders-sync',
                    marketplaceId: String(mp._id),
                    priority: 0, // Low priority
                    metadata: {
                        reason: 'hourly_schedule',
                        batchSize: 50 // Sync last 50 orders
                    }
                });
                this.logger.log(`Queued orders-sync for Marketplace ${mp.name}`);
            }
        } catch (error) {
            this.logger.error('Error in Hourly Orders Sync:', error);
        }
    }

    // Nightly Cleanup: Remove old completed/failed queue records
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleCronCleanup() {
        this.logger.log('Starting Nightly Cleanup Job...');
        try {
            const deletedCount = await this.queueService.cleanupOldRecords(7); // Keep 7 days history
            this.logger.log(`Cleanup complete. Deleted ${deletedCount} old records.`);
        } catch (error) {
            this.logger.error('Error in Nightly Cleanup:', error);
        }
    }
}
