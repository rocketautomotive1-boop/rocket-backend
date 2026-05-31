import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '../queue/queue.service';
import { MarketplaceAuthService } from '../marketplace/auth/services/marketplace-auth.service';
import { MarketplaceAccountService } from '../marketplace/auth/services/marketplace-account.service';
import { QuestionsService } from '../questions/questions.service';
import { OrderSyncFlowService } from '../order/services/order-sync-flow.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly queueService: QueueService,
        @Inject(forwardRef(() => MarketplaceAuthService))
        private readonly marketplaceAuthService: MarketplaceAuthService,
        @Inject(forwardRef(() => MarketplaceAccountService))
        private readonly marketplaceAccountService: MarketplaceAccountService,
        @Inject(forwardRef(() => QuestionsService))
        private readonly questionsService: QuestionsService,
        @Inject(forwardRef(() => OrderSyncFlowService))
        private readonly orderSyncFlowService: OrderSyncFlowService,
    ) { }

    // On startup: immediately reconcile orders that may have arrived while offline
    async onModuleInit() {
        // Small delay to let other modules (auth, tokens) initialize first
        setTimeout(() => {
            this.logger.log('Startup reconciliation: syncing recent orders from all marketplaces...');
            this.handleCronOrdersSync().catch(err =>
                this.logger.error(`Startup orders reconciliation failed: ${err.message}`),
            );
        }, 10_000);
    }

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

        // Caminho paralelo: contas multi-client (não afeta o refresh legado acima).
        try {
            const accountCount = await this.marketplaceAccountService.refreshExpiringAccountTokens();
            if (accountCount > 0) {
                this.logger.log(`Proactive Refresh (accounts): ${accountCount} account tokens refreshed.`);
            }
        } catch (error) {
            this.logger.error('Error in Scheduled Account Token Refresh:', error);
        }
    }

    // Hourly Sync: Orders (Safety Net for missed webhooks)
    @Cron(CronExpression.EVERY_HOUR)
    async handleCronOrdersSync() {
        this.logger.log('Starting Hourly Orders Sync Job...');

        try {
            const result = await this.orderSyncFlowService.queueScheduledOrdersSync({
                reason: 'hourly_schedule',
                batchSize: 50,
            });
            this.logger.log(
                `Hourly orders sync queued=${result.queued} skipped=${result.skipped.length}`,
            );
        } catch (error) {
            this.logger.error('Error in Hourly Orders Sync:', error);
        }
    }

    // Every 5 Minutes: Sync questions from marketplaces (fallback for missed webhooks)
    @Cron('0 */5 * * * *')
    async handleQuestionSync() {
        this.logger.log('Starting Scheduled Questions Sync...');
        try {
            await this.questionsService.syncQuestions();
            this.logger.log('Questions Sync completed.');
        } catch (error) {
            this.logger.error('Error in Questions Sync:', error);
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

    // Every 30 Minutes: ML compliance checks — migrated to orchestrator-ms
    @Cron('0 */30 * * * *')
    async handleItemModerationCheck() {
        this.logger.log('Item Moderation/Compliance Check delegated to orchestrator-ms — skipping.');
    }
}
