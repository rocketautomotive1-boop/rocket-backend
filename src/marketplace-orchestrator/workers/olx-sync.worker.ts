import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import axios from 'axios';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';
import { PayloadBuilderService } from '../services/payload-builder.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class OLXSyncWorker {
    private readonly logger = new Logger(OLXSyncWorker.name);
    private readonly baseUrl = 'https://apps.olx.com.br';

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly resilienceService: MarketplaceResilienceService,
        private readonly payloadBuilder: PayloadBuilderService,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.sync',
        routingKey: 'sync.olx',
        queue: 'q.sync.olx',
    })
    async handleOLXSync(msg: MarketplaceSyncPayload) {
        this.logger.log(`[OLX] Processing job ${msg.jobId} for listing ${msg.listingId} (${msg.action})`);

        const result: MarketplaceSyncResult = {
            jobId: msg.jobId,
            attemptId: msg.attemptId,
            listingId: msg.listingId,
            marketplaceId: msg.marketplaceId,
            success: false,
            action: msg.action,
            timestamp: new Date(),
        };

        try {
            // Idempotency guard: upgrade CREATE → UPDATE if listing already has externalId
            if (msg.action === 'CREATE') {
                const freshListing = await this.listingModel
                    .findById(msg.listingId)
                    .select('externalId status')
                    .lean()
                    .exec();

                if (freshListing?.externalId) {
                    this.logger.warn(
                        `[Idempotency] Listing ${msg.listingId} already has externalId=${freshListing.externalId}. ` +
                        `Upgrading action from CREATE to UPDATE.`,
                    );
                    msg.action = 'UPDATE';
                    msg.externalId = freshListing.externalId;
                }
            }

            await this.resilienceService.execute(msg.marketplaceId, async (token) => {
                const accessToken = token.accessToken;
                if (!accessToken) throw new Error('Access token missing for OLX.');

                if (msg.action === 'CREATE' || msg.action === 'UPDATE') {
                    const body = this.payloadBuilder.buildOLXImportBody(msg, accessToken);
                    this.logger.debug(`[OLX] autoupload/import payload for ${msg.listingId}:\n${JSON.stringify(body, null, 2)}`);

                    const response = await axios.put(`${this.baseUrl}/autoupload/import`, body, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 15000,
                    });

                    this.logger.debug(`[OLX] autoupload/import response: ${JSON.stringify(response.data)}`);

                    if (response.data?.statusCode !== undefined && response.data.statusCode !== 0) {
                        throw new Error(
                            `OLX API error (statusCode ${response.data.statusCode}): ${response.data.statusMessage || 'Unknown error'}`,
                        );
                    }

                    // Extract external ad ID from response
                    if (!response.data?.ad_list?.length) {
                        this.logger.warn(`[OLX] Response missing ad_list for listing ${msg.listingId}: ${JSON.stringify(response.data)}`);
                    }
                    const adEntry = response.data?.ad_list?.[0];
                    const adId = adEntry?.id || adEntry?.ad_id;
                    if (adId) {
                        result.externalId = String(adId);
                    } else if (msg.externalId) {
                        result.externalId = msg.externalId;
                        this.logger.debug(`[OLX] API did not return ad ID — using existing externalId=${msg.externalId}`);
                    }

                    this.logger.log(`[OLX] ${msg.action} OK for listing ${msg.listingId} → adId=${result.externalId}`);

                } else if (msg.action === 'DELETE') {
                    if (!msg.externalId) throw new Error('DELETE action requires externalId');

                    const deleteBody = this.payloadBuilder.buildOLXDeleteBody(accessToken);
                    const response = await axios.delete(`${this.baseUrl}/api/ads/${msg.externalId}`, {
                        data: deleteBody,
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 15000,
                    });

                    this.logger.log(`[OLX] Deleted ad ${msg.externalId}: ${JSON.stringify(response.data)}`);
                    result.externalId = msg.externalId;
                }
            });

            result.success = true;

        } catch (error) {
            const statusCode = error.response?.status || 'N/A';
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            const errorMsg = `[Status ${statusCode}] ${errorData}`;
            this.logger.error(`[OLX] Failed job ${msg.jobId}: ${errorMsg}`);
            result.success = false;
            result.errorMessage = errorMsg;
        } finally {
            await this.amqpConnection.publish(
                'rocket.marketplace.results',
                'result.olx',
                result,
            );
        }
    }
}
