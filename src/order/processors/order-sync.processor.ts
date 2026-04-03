import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderService } from '../order.service';
import { QueueService } from '../../queue/queue.service';
import { QueueRecordModel, QueueRecordDocument } from '../../queue/schemas/queue-record.schema';
import { ORDER_EVENTS } from '../events/order.events';

@Injectable()
export class OrderSyncProcessor implements OnModuleInit {
    private readonly logger = new Logger(OrderSyncProcessor.name);
    /** Guards against concurrent pipeline runs for the same externalId */
    private readonly inFlight = new Set<string>();

    constructor(
        private readonly orderService: OrderService,
        private readonly queueService: QueueService,
        private readonly eventEmitter: EventEmitter2,
        @InjectModel(QueueRecordModel.name)
        private readonly queueRecordModel: Model<QueueRecordDocument>,
    ) { }

    /** Ao inicializar, re-emite jobs orders-sync que ficaram travados por restart */
    async onModuleInit(): Promise<void> {
        setTimeout(() => this.recoverStalledJobs(), 15_000);
    }

    private async recoverStalledJobs(): Promise<void> {
        const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min atrás

        const stalled = await this.queueRecordModel.find({
            type: 'orders-sync',
            status: { $in: ['pending', 'processing'] },
            createdAt: { $lte: staleThreshold },
        }).lean().exec();

        if (!stalled.length) return;

        this.logger.warn(`[Processor] Recovering ${stalled.length} stalled orders-sync job(s)`);

        for (const record of stalled) {
            const externalId = record.metadata?.externalId;
            if (!externalId) continue;

            this.logger.log(`[Processor] Re-emitting orders-sync for order ${externalId} (job ${record._id})`);
            this.eventEmitter.emit('orders-sync', {
                externalId,
                marketplaceId: String(record.marketplaceId),
                queueRecordId: record._id.toString(),
            });
        }
    }

    @OnEvent('orders-sync')
    async handleOrderSync(payload: any) {
        const { externalId, marketplaceId, queueRecordId, source } = payload;

        // Concurrent duplicate guard: skip if already processing this order
        if (this.inFlight.has(externalId)) {
            this.logger.warn(`[Processor] Order ${externalId} already in-flight — skipping duplicate event`);
            if (queueRecordId) {
                await this.queueService.failJob(queueRecordId, 'Duplicate: already processing');
            }
            return;
        }

        this.inFlight.add(externalId);
        this.logger.log(`[Processor] Processing Order Sync Job for ${externalId} (source=${source ?? 'sync'})`);

        if (queueRecordId) {
            await this.queueService.startJob(queueRecordId);
        }

        try {
            await this.orderService.processSyncOrder({ externalId, marketplaceId, source: source ?? 'sync' });

            if (queueRecordId) {
                await this.queueService.completeJob(queueRecordId, { success: true });
            }

            this.logger.log(`[Processor] Order ${externalId} synced successfully`);
            this.eventEmitter.emit(ORDER_EVENTS.SYNC_COMPLETED, { externalId, marketplaceId });
        } catch (error) {
            this.logger.error(`[Processor] Failed to sync order ${externalId}`, error);
            if (queueRecordId) {
                await this.queueService.failJob(queueRecordId, error.message);
            }

            this.eventEmitter.emit(ORDER_EVENTS.SYNC_FAILED, {
                externalId,
                marketplaceId,
                error: error.message,
            });
        } finally {
            this.inFlight.delete(externalId);
        }
    }
}
