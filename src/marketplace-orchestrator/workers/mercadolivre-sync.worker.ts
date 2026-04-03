import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import axios from 'axios';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';
import { PayloadBuilderService } from '../services/payload-builder.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class MercadoLivreSyncWorker {
    private readonly logger = new Logger(MercadoLivreSyncWorker.name);
    private readonly baseUrl = 'https://api.mercadolibre.com';

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly resilienceService: MarketplaceResilienceService,
        private readonly payloadBuilder: PayloadBuilderService,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.sync',
        routingKey: 'sync.mercadolivre',
        queue: 'q.sync.mercadolivre',
    })
    async handleSync(msg: MarketplaceSyncPayload) {
        this.logger.log(`[MercadoLivre] Processing job ${msg.jobId} (Attempt ${msg.attemptId}) for listing ${msg.listingId}`);

        const result: MarketplaceSyncResult = {
            jobId: msg.jobId,
            attemptId: msg.attemptId,
            listingId: msg.listingId,
            marketplaceId: msg.marketplaceId,
            success: false,
            action: msg.action,
            timestamp: new Date()
        };

        try {
            if (msg.action === 'CREATE') {
                const freshListing = await this.listingModel
                    .findById(msg.listingId)
                    .select('externalId status')
                    .lean()
                    .exec();

                if (freshListing?.externalId) {
                    this.logger.warn(
                        `[Idempotency] Listing ${msg.listingId} already has externalId=${freshListing.externalId}. ` +
                        `Upgrading action from CREATE to UPDATE.`
                    );
                    msg.action = 'UPDATE';
                    msg.externalId = freshListing.externalId;
                }
            }

            await this.resilienceService.execute(msg.marketplaceId, async (token) => {
                const accessToken = token.accessToken;
                if (!accessToken) throw new Error('Access token missing in refreshed token.');

                const headers = {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                };

                let externalId = null;

                if (msg.action === 'CREATE') {
                    const body = this.payloadBuilder.buildMercadoLivreCreateBody(msg);
                    this.logger.debug(`[MercadoLivre] CREATE payload for ${externalId}: ${JSON.stringify(body)}`);

                    const response = await axios.post(`${this.baseUrl}/items`, body, { headers });
                    externalId = response.data.id;
                    this.logger.log(`[MercadoLivre] Created item ${externalId}`);

                    await this.updateDescription(externalId, msg.payload.description, headers);

                } else if (msg.action === 'DELETE') {
                    if (!msg.externalId) throw new Error('DELETE action requires externalId');
                    externalId = msg.externalId;

                    await axios.put(`${this.baseUrl}/items/${externalId}`, { status: 'closed' }, { headers });
                    this.logger.log(`[MercadoLivre] Closed (removed) item ${externalId}`);

                } else if (msg.action === 'UPDATE') {
                    if (!msg.externalId) throw new Error("UPDATE action requires externalId in DTO");

                    externalId = msg.externalId;
                    const partialErrors: string[] = [];

                    // 1. Operational fields (price + stock) — critical
                    const operationalBody = this.payloadBuilder.buildMercadoLivreOperationalBody(msg);

                    if (Object.keys(operationalBody).length > 0) {
                        this.logger.debug(`[MercadoLivre] UPDATE operational for ${externalId}: ${JSON.stringify(operationalBody)}`);
                        await axios.put(`${this.baseUrl}/items/${externalId}`, operationalBody, { headers });
                        this.logger.log(`[MercadoLivre] Updated operational fields for ${externalId}`);
                    }

                    // 2. Content fields (pictures + attributes) — tolerated
                    try {
                        const contentBody = this.payloadBuilder.buildMercadoLivreContentBody(msg);
                        this.logger.debug(`[MercadoLivre] UPDATE content for ${externalId}: ${JSON.stringify(contentBody)}`);
                        await axios.put(`${this.baseUrl}/items/${externalId}`, contentBody, { headers });
                        this.logger.log(`[MercadoLivre] Updated content fields for ${externalId}`);
                    } catch (e) {
                        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                        this.logger.warn(`[MercadoLivre] Content update failed — operational fields already saved: ${detail}`);
                        partialErrors.push(`content: ${detail}`);
                    }

                    // 3. Description
                    await this.updateDescription(externalId, msg.payload.description, headers);

                    if (partialErrors.length > 0) {
                        this.logger.warn(`[MercadoLivre] UPDATE partial for ${externalId}: ${partialErrors.join(' | ')}`);
                    } else {
                        this.logger.log(`[MercadoLivre] Updated item ${externalId}`);
                    }
                }

                result.externalId = externalId;
            });

            result.success = true;


        } catch (error) {
            const statusCode = error.response?.status || 'N/A';
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            const errorMsg = `[Status ${statusCode}] ${errorData}`;

            this.logger.error(`[MercadoLivre] Failed job ${msg.jobId} for action ${msg.action}: ${errorMsg}`);
            this.logger.debug(`[MercadoLivre] Failed payload: ${JSON.stringify(msg.payload)}`);

            result.success = false;
            result.errorMessage = errorMsg;
        } finally {
            await this.amqpConnection.publish(
                'rocket.marketplace.results',
                'result.mercadolivre',
                result
            );
        }
    }

    private async updateDescription(externalId: string, description: string, headers: any) {
        if (!description) return;
        try {
            const body = this.payloadBuilder.buildMercadoLivreDescriptionBody(description);
            await axios.put(`${this.baseUrl}/items/${externalId}/description`, body, { headers });
            this.logger.log(`[MercadoLivre] Updated description for ${externalId}`);
        } catch (error) {
            this.logger.warn(`[MercadoLivre] Failed to update description for ${externalId}: ${error.message}`);
        }
    }
}
