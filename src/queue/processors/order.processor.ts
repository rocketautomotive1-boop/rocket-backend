import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Ctx, RmqContext } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../schemas/queue-record.schema';
import { QueueService } from '../queue.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { globalThrottle } from '../../common/utils/throttle.util';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Controller()
export class OrderProcessor {
    private readonly logger = new Logger(OrderProcessor.name);

    constructor(
        @InjectModel(QueueRecordModel.name)
        private queueRecordModel: Model<QueueRecordDocument>,
        private readonly queueService: QueueService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly eventEmitter: EventEmitter2
    ) { }

    @MessagePattern('orders-sync')
    async processOrdersSync(data: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        let payload = data?.queueRecordId ? data : JSON.parse(originalMsg.content.toString()).data;
        const queueRecordId = payload?.queueRecordId;

        if (!queueRecordId) {
            channel.ack(originalMsg);
            return;
        }

        try {
            const queueRecord = await this.queueRecordModel.findById(queueRecordId).exec();
            if (!queueRecord) { channel.ack(originalMsg); return; }

            await this.queueService.updateQueueRecord(queueRecordId, {
                status: 'processing', metadata: { ...queueRecord.metadata, attempts: (queueRecord.attempts || 0) + 1 }
            });

            // Fix: Check root marketplaceId if not in metadata
            const marketplaceId = queueRecord.metadata?.marketplaceId || queueRecord.marketplaceId;
            const orderIds = queueRecord.metadata?.orderIds;
            const batchSize = queueRecord.metadata?.batchSize;

            // Check for Single Order Sync (Manual Trigger via External ID)
            const singleExternalId = queueRecord.metadata?.externalId;

            if (singleExternalId) {
                this.logger.log(`[Processor] Delegating Single Order Sync: ${singleExternalId} (Marketplace: ${marketplaceId})`);

                // Delegate to Domain Logic via EventBridge (handled by OrderSyncProcessor in order module)
                // We use emitAsync to wait for completion
                await this.eventEmitter.emitAsync('orders-sync', {
                    externalId: singleExternalId,
                    marketplaceId: marketplaceId ? String(marketplaceId) : undefined,
                    queueRecordId
                });

                // Note: OrderSyncProcessor handles completion/failure of the job internally?
                // Checking OrderSyncProcessor: it calls queueService.completeJob/failJob.
                // So we DON'T need to complete it here again to avoid double-update race, 
                // BUT we DO need to ACK the RMQ message.
                channel.ack(originalMsg);
                return;
            }

            // --- Bulk Sync Logic ---

            if (!marketplaceId) {
                throw new Error('Marketplace ID undefined');
            }

            // Throttle order sync per marketplace
            await globalThrottle.throttle(`orders-sync-${marketplaceId}`, 2000); // 1 req / 2 sec

            const result = await this.marketplaceOrderService.syncOrdersToMovements(String(marketplaceId), { orderIds, batchSize });

            await this.queueService.updateQueueRecord(queueRecordId, {
                status: 'completed', completedAt: new Date(), result: result
            });

            channel.ack(originalMsg);
        } catch (error) {
            this.logger.error(`Erro sync pedidos: ${error.message}`);
            await this.queueService.handleProcessFailure(queueRecordId, error.message);
            channel.ack(originalMsg);
        }
    }
}
