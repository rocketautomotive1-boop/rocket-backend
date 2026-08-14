import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from './queue.service';

/**
 * Limpeza noturna dos QueueRecord antigos (completed/failed). Retenção é
 * responsabilidade do dono dos dados da fila — por isso vive no QueueModule,
 * injetando QueueService direto. A casca só define QUANDO rodar.
 */
@Injectable()
export class QueueCleanupScheduler {
    private readonly logger = new Logger(QueueCleanupScheduler.name);

    constructor(private readonly queueService: QueueService) {}

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
