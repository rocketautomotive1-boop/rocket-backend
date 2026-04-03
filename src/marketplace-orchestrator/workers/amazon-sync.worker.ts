import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import * as aws4 from 'aws4';
import axios from 'axios';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';
import { PayloadBuilderService } from '../services/payload-builder.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class AmazonSyncWorker {
    private readonly logger = new Logger(AmazonSyncWorker.name);

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly resilienceService: MarketplaceResilienceService,
        private readonly payloadBuilder: PayloadBuilderService,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.sync',
        routingKey: 'sync.amazon',
        queue: 'q.sync.amazon',
    })
    async handleSync(msg: MarketplaceSyncPayload) {
        this.logger.log(`[Amazon] Processing job ${msg.jobId} (Attempt ${msg.attemptId}) for listing ${msg.listingId}`);

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
                if (!token.accessToken) throw new Error('Access token missing in refreshed token.');

                const sku = String(msg.product._id);
                if (!sku) throw new Error('product._id is required as SKU for Amazon SP-API publish.');

                if (msg.action === 'DELETE') {
                    const deleteResult = await this.deleteListingItem(sku, token);
                    if (!deleteResult.success) {
                        throw new Error(deleteResult.error || 'Amazon rejected the deletion');
                    }
                    result.externalId = sku;
                    this.logger.log(`[Amazon] Deleted listing for SKU ${sku}`);
                    return;
                }

                const payload = this.payloadBuilder.buildAmazonSpApiPayload(msg);

                this.logger.debug(
                    `[Amazon] job=${msg.jobId} action=${msg.action} sku=${sku} payload=${JSON.stringify(payload)}`
                );

                const putResult = await this.putListingItem(sku, payload, token);

                if (!putResult.success) {
                    throw new Error(putResult.error || 'Amazon rejected the listing');
                }

                result.externalId = sku;
                this.logger.log(
                    `[Amazon] ${msg.action} succeeded for SKU ${sku} | productType=${payload.productType} ` +
                    `price=${msg.payload.price} stock=${msg.payload.stock} images=${msg.payload.images?.length ?? 0}`
                );
            });

            result.success = true;

        } catch (error) {
            const statusCode = error.response?.status || 'N/A';
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            const errorMsg = `[Status ${statusCode}] ${errorData}`;

            this.logger.error(`[Amazon] Failed job ${msg.jobId} for action ${msg.action}: ${errorMsg}`);
            this.logger.debug(`[Amazon] Failed payload: ${JSON.stringify(msg.payload)}`);

            result.success = false;
            result.errorMessage = errorMsg;
        } finally {
            await this.amqpConnection.publish(
                'rocket.marketplace.results',
                'result.amazon',
                result
            );
        }
    }

    private async putListingItem(sku: string, payload: any, token: any): Promise<{ success: boolean; error?: string }> {
        const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
        const region = process.env.AMAZON_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
        const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
        const sellerId = process.env.AMAZON_SELLER_ID || token.additionalData?.sellerId;

        if (!accessKeyId || !secretAccessKey) {
            throw new Error('AWS credentials (AMAZON_AWS_ACCESS_KEY / AMAZON_AWS_SECRET_KEY) not configured.');
        }
        if (!sellerId) {
            throw new Error('Amazon Seller ID not configured (AMAZON_SELLER_ID or token.additionalData.sellerId).');
        }

        const path = `/listings/2021-08-01/items/${sellerId}/${sku}`;
        const queryString = `marketplaceIds=A2Q3Y263D00KWC`;

        const requestOptions: aws4.Request = {
            host: endpoint.replace('https://', ''),
            path: `${path}?${queryString}`,
            method: 'PUT',
            headers: {
                'x-amz-access-token': token.accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            region,
            service: 'execute-api',
        };

        aws4.sign(requestOptions, { accessKeyId, secretAccessKey });

        try {
            const { data } = await axios.put(`${endpoint}${path}?${queryString}`, payload, {
                headers: requestOptions.headers,
            });

            const status: string = data?.status;
            const submissionId: string = data?.submissionId;
            const issues: any[] = data?.issues ?? [];

            this.logger.log(
                `[Amazon] SP-API response | sku=${sku} status=${status} submissionId=${submissionId} issues=${JSON.stringify(issues)}`
            );

            if (status === 'INVALID') {
                return { success: false, error: `Amazon rejected listing (INVALID). Issues: ${JSON.stringify(issues)}` };
            }

            const errorIssues = issues.filter(i => i.severity === 'ERROR');
            if (errorIssues.length > 0) {
                return { success: false, error: `Amazon accepted submission but reported errors. Issues: ${JSON.stringify(errorIssues)}` };
            }

            if (issues.length > 0) {
                this.logger.warn(`[Amazon] Submission accepted with warnings | sku=${sku} issues=${JSON.stringify(issues)}`);
            }

            return { success: true };

        } catch (error: any) {
            const errData = error.response?.data;
            const issues = errData?.issues ? JSON.stringify(errData.issues) : JSON.stringify(errData || error.message);
            return { success: false, error: `Amazon PUT failed: ${issues}` };
        }
    }

    private async deleteListingItem(sku: string, token: any): Promise<{ success: boolean; error?: string }> {
        const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
        const region = process.env.AMAZON_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
        const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
        const sellerId = process.env.AMAZON_SELLER_ID || token.additionalData?.sellerId;

        if (!accessKeyId || !secretAccessKey) {
            throw new Error('AWS credentials not configured.');
        }
        if (!sellerId) {
            throw new Error('Amazon Seller ID not configured.');
        }

        const path = `/listings/2021-08-01/items/${sellerId}/${sku}`;
        const queryString = 'marketplaceIds=A2Q3Y263D00KWC';

        const requestOptions: aws4.Request = {
            host: endpoint.replace('https://', ''),
            path: `${path}?${queryString}`,
            method: 'DELETE',
            headers: {
                'x-amz-access-token': token.accessToken,
                'Content-Type': 'application/json',
            },
            region,
            service: 'execute-api',
        };

        aws4.sign(requestOptions, { accessKeyId, secretAccessKey });

        try {
            await axios.delete(`${endpoint}${path}?${queryString}`, {
                headers: requestOptions.headers,
            });
            this.logger.log(`[Amazon] DELETE succeeded for SKU ${sku}`);
            return { success: true };
        } catch (error: any) {
            const errData = error.response?.data;
            const detail = errData?.issues ? JSON.stringify(errData.issues) : JSON.stringify(errData || error.message);
            return { success: false, error: `Amazon DELETE failed: ${detail}` };
        }
    }
}
