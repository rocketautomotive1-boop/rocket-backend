import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Ctx, RmqContext } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QueueRecordModel, QueueRecordDocument } from '../schemas/queue-record.schema';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';

import { QueueService } from '../queue.service';

@Controller()
export class CompatibilityProcessor {
    private readonly logger = new Logger(CompatibilityProcessor.name);

    constructor(
        @InjectModel(QueueRecordModel.name)
        private queueRecordModel: Model<QueueRecordDocument>,
        private readonly queueService: QueueService,
        private readonly mercadoLivreCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    ) { }

    @MessagePattern('product-sync-compatibilities')
    async processProductSyncCompatibilities(payload: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        const queueRecordId = payload.queueRecordId;

        try {
            const queueRecord = await this.queueRecordModel.findById(queueRecordId).exec();
            if (!queueRecord) { channel.ack(originalMsg); return; }

            await this.queueRecordModel.findByIdAndUpdate(queueRecordId, {
                status: 'processing', startedAt: new Date(), attempts: (queueRecord.attempts || 0) + 1
            });

            const syncData = queueRecord.metadata?.syncData || payload.metadata?.syncData || payload.syncData;
            const marketplaceName = syncData?.marketplaceName;
            const productTitles = Array.isArray(syncData?.productTitles) ? syncData.productTitles : [];
            const compatibilities = Array.isArray(syncData?.compatibilities) ? syncData.compatibilities : [];

            const results: any[] = [];
            let successCount = 0;
            let errorCount = 0;

            if (marketplaceName === 'Mercado Livre') {
                const vehicleIds = compatibilities.map((c: any) => c.vehicleId).filter(Boolean);
                const chunkSize = 50;
                const chunks: string[][] = [];
                for (let i = 0; i < vehicleIds.length; i += chunkSize) chunks.push(vehicleIds.slice(i, i + chunkSize));

                for (const title of productTitles) {
                    if (!title.externalId) {
                        results.push({ titleId: title.id, status: 'skipped', reason: 'missing_externalId' });
                        continue;
                    }
                    for (const chunk of chunks) {
                        try {
                            const payloadML = { products: chunk.map(id => ({ id })), site_id: 'MLB', domain_id: 'MLB-CARS_AND_VANS' };
                            const resp = await this.mercadoLivreCompatibilityAdapter.syncCompatibility(title.externalId, payloadML);
                            results.push({ titleId: title.id, status: 'success', response: resp });
                            successCount += chunk.length;
                        } catch (err) {
                            results.push({ titleId: title.id, status: 'error', message: err?.message });
                            errorCount += chunk.length;
                        }
                    }
                }
            }

            await this.queueRecordModel.findByIdAndUpdate(queueRecordId, {
                status: 'completed', completedAt: new Date(),
                result: { success: errorCount === 0, successCount, errorCount, results }
            });

            channel.ack(originalMsg);
        } catch (error) {
            this.logger.error(`Erro compatibilidades: ${error.message}`);
            await this.queueService.handleProcessFailure(queueRecordId, error.message);
            channel.ack(originalMsg);
        }
    }
}
