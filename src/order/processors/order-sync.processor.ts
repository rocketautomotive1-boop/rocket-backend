import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderService } from '../order.service';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class OrderSyncProcessor {
    private readonly logger = new Logger(OrderSyncProcessor.name);

    constructor(
        private readonly orderService: OrderService,
        private readonly queueService: QueueService
    ) { }

    @OnEvent('orders-sync')
    async handleOrderSync(payload: any) {
        const { externalId, marketplaceId, queueRecordId } = payload;
        this.logger.log(`[Processor] Processing Order Sync Job for ${externalId}`);

        if (queueRecordId) {
            await this.queueService.startJob(queueRecordId);
        }

        try {
            await this.orderService.processSyncOrder({ externalId, marketplaceId });

            if (queueRecordId) {
                await this.queueService.completeJob(queueRecordId, { success: true });
            }
        } catch (error) {
            this.logger.error(`[Processor] Failed to sync order ${externalId}`, error);
            if (queueRecordId) {
                await this.queueService.failJob(queueRecordId, error.message);
            }
        }
    }
}
