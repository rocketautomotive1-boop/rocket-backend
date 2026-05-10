import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingModel } from '../listing/schemas/listing.schema';
import { SyncGateway } from '../gateways/sync.gateway';

interface SyncResultMessage {
    syncRequestId: string;
    listingId: string;
    productId: string;
    marketplaceId: string;
    marketplaceTag?: string;
    success: boolean;
    externalId?: string;
    errorMessage?: string;
    errorClassifier?: string;
    processedAt?: string;
}

@Injectable()
export class SyncResultConsumer {
    private readonly logger = new Logger(SyncResultConsumer.name);

    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        private readonly syncGateway: SyncGateway,
    ) {}

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
        queueOptions: { durable: true },
    })
    async handle(msg: SyncResultMessage): Promise<void> {
        this.logger.log(
            `Sync result received: listing=${msg.listingId} success=${msg.success} externalId=${msg.externalId}`,
        );

        const marketplaceTag = msg.marketplaceTag ?? String(msg.marketplaceId);

        if (msg.success && msg.externalId) {
            await this.listingModel.findByIdAndUpdate(msg.listingId, {
                $set: {
                    externalId: msg.externalId,
                    status: 'active',
                    synchronized: true,
                    errorMessage: null,
                    lastSyncAt: new Date(),
                    publishingAt: null,
                    'marketplaceData.syncIssue': null,
                    'marketplaceData.recreateRequired': false,
                },
            });

            this.syncGateway.emitSyncCompleted({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                externalId: msg.externalId,
                marketplaceTag,
                success: true,
            });
        } else if (!msg.success) {
            await this.listingModel.findByIdAndUpdate(msg.listingId, {
                $set: {
                    status: 'error',
                    errorMessage: msg.errorMessage ?? 'Sync failed',
                    synchronized: false,
                    lastSyncAt: new Date(),
                    publishingAt: null,
                },
            });

            this.syncGateway.emitSyncFailed({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                errorMessage: msg.errorMessage ?? 'Sync failed',
                errorClassifier: msg.errorClassifier,
                marketplaceTag,
                success: false,
            });
        }
    }
}
