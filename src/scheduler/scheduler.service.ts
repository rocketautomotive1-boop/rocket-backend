import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '../queue/queue.service';
import { MarketplaceTokenBrokerService } from '../marketplace/auth/services/marketplace-token-broker.service';
import { QuestionsService } from '../questions/questions.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly queueService: QueueService,
        @Inject(forwardRef(() => MarketplaceTokenBrokerService))
        private readonly tokenBroker: MarketplaceTokenBrokerService,
        @Inject(forwardRef(() => QuestionsService))
        private readonly questionsService: QuestionsService,
    ) { }

    async onModuleInit() {
        this.logger.log('Scheduler init — orders discovery handled by OrderReconciler');
    }

    // Every 10 Minutes: Refresh tokens that are about to expire (Proactive Refresh)
    @Cron('0 */10 * * * *')
    async handleTokenRefresh() {
        this.logger.log('Starting Scheduled Token Refresh Check...');
        try {
            const count = await this.tokenBroker.refreshExpiringTokens();
            this.logger.log(
                count > 0 ? `Proactive Refresh: ${count} account tokens refreshed.` : 'Proactive Refresh: No tokens needing refresh.',
            );
        } catch (error) {
            this.logger.error('Error in Scheduled Token Refresh:', error);
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

    // ML compliance / item-moderation checks live entirely in microservices/moderations now.
}
