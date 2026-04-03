import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import axios from 'axios';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import { getShopeeBaseUrl, buildSignedParams, buildHeaders } from '../../marketplace/adapters/shopee/shopee-utils';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';
import { PayloadBuilderService } from '../services/payload-builder.service';
import { ListingModel, ListingDocument } from '../../listing/schemas/listing.schema';

@Injectable()
export class ShopeeSyncWorker {
    private readonly logger = new Logger(ShopeeSyncWorker.name);
    private readonly baseUrl = getShopeeBaseUrl();

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly resilienceService: MarketplaceResilienceService,
        private readonly payloadBuilder: PayloadBuilderService,
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingDocument>,
    ) { }

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.sync',
        routingKey: 'sync.shopee',
        queue: 'q.sync.shopee',
    })
    async handleShopeeSync(msg: MarketplaceSyncPayload) {
        this.logger.log(`[Shopee] Processing job ${msg.jobId} for listing ${msg.listingId} (${msg.action})`);

        const result: MarketplaceSyncResult = {
            jobId: msg.jobId,
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
                const shopId = token.additionalData?.shopId || token.shopId;
                if (!shopId) throw new Error('ShopId not found in token');

                let imageIds: string[] = [];
                if (msg.payload.images && msg.payload.images.length > 0) {
                    imageIds = await this.prepareImages(msg.payload.images, token);
                }

                const timestamp = Math.floor(Date.now() / 1000);

                if (msg.action === 'CREATE') {
                    const path = '/product/add_item';
                    const logisticInfo = await this.getEnabledLogistics(token, shopId);
                    const body = this.payloadBuilder.buildShopeeCreateBody(msg, imageIds, logisticInfo);

                    const params = buildSignedParams(path, timestamp, token.accessToken, shopId);

                    this.logger.log(`[Shopee] add_item payload for listing ${msg.listingId}:\n${JSON.stringify(body, null, 2)}`);

                    const response = await axios.post(`${this.baseUrl}${path}`, body, {
                        headers: buildHeaders(),
                        params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
                    });

                    this.logger.log(`[Shopee] add_item response: ${JSON.stringify(response.data)}`);

                    if (response.data.error) {
                        throw new Error(`Shopee API Error: ${response.data.message || response.data.error}`);
                    }

                    if (!response.data.response || !response.data.response.item_id) {
                        throw new Error(`Invalid Shopee Response (No item_id): ${JSON.stringify(response.data)}`);
                    }

                    result.externalId = String(response.data.response.item_id);
                    this.logger.log(`[Shopee] Created item ${result.externalId}`);

                } else if (msg.action === 'DELETE') {
                    if (!msg.externalId) throw new Error('DELETE action requires externalId');

                    const deletePath = '/product/unlist_item';
                    const deleteTimestamp = Math.floor(Date.now() / 1000);
                    const deleteParams = buildSignedParams(deletePath, deleteTimestamp, token.accessToken, shopId);
                    const deleteBody = this.payloadBuilder.buildShopeeDeleteBody(msg.externalId);

                    const deleteResponse = await axios.post(`${this.baseUrl}${deletePath}`, deleteBody, {
                        headers: buildHeaders(),
                        params: { ...deleteParams, access_token: token.accessToken, shop_id: Number(shopId) },
                    });

                    if (deleteResponse.data.error) {
                        throw new Error(`Shopee unlist error: ${deleteResponse.data.message || deleteResponse.data.error}`);
                    }

                    result.externalId = msg.externalId;
                    this.logger.log(`[Shopee] Unlisted (removed) item ${msg.externalId}`);

                } else if (msg.action === 'UPDATE') {
                    if (!msg.externalId) throw new Error('Update requires externalId');

                    const partialErrors: string[] = [];

                    // 1. Content update — tolerated
                    try {
                        const path = '/product/update_item';
                        const body = this.payloadBuilder.buildShopeeUpdateItemBody(msg, imageIds);
                        const params = buildSignedParams(path, timestamp, token.accessToken, shopId);
                        const response = await axios.post(`${this.baseUrl}${path}`, body, {
                            headers: buildHeaders(),
                            params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
                        });
                        if (response.data.error) throw new Error(response.data.message || response.data.error);
                        this.logger.log(`[Shopee] update_item OK for ${msg.externalId}`);
                    } catch (e) {
                        const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                        this.logger.warn(`[Shopee] update_item failed — proceeding with stock/price: ${detail}`);
                        partialErrors.push(`content: ${detail}`);
                    }

                    // 2. Stock update — critical
                    if (msg.payload.stock !== undefined) {
                        try {
                            await this.updateStock(msg.externalId, msg.payload.stock, token);
                            this.logger.log(`[Shopee] updateStock OK for ${msg.externalId}`);
                        } catch (e) {
                            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                            this.logger.error(`[Shopee] updateStock failed for ${msg.externalId}: ${detail}`);
                            partialErrors.push(`stock: ${detail}`);
                        }
                    }

                    // 3. Price update — critical
                    if (msg.payload.price !== undefined && msg.payload.price > 0) {
                        try {
                            await this.updatePrice(msg.externalId, msg.payload.price, token);
                            this.logger.log(`[Shopee] updatePrice OK for ${msg.externalId}`);
                        } catch (e) {
                            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                            this.logger.error(`[Shopee] updatePrice failed for ${msg.externalId}: ${detail}`);
                            partialErrors.push(`price: ${detail}`);
                        }
                    }

                    result.externalId = msg.externalId;

                    if (partialErrors.length > 0) {
                        this.logger.warn(`[Shopee] UPDATE partial for ${msg.externalId}: ${partialErrors.join(' | ')}`);
                        const criticalErrors = partialErrors.filter(e => e.startsWith('stock:') || e.startsWith('price:'));
                        if (criticalErrors.length > 0) throw new Error(criticalErrors.join(' | '));
                    } else {
                        this.logger.log(`[Shopee] Updated item ${result.externalId}`);
                    }
                }

            });

            result.success = true;

        } catch (error) {
            const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`[Shopee] Failed job ${msg.jobId}: ${errorMsg}`);
            result.success = false;
            result.errorMessage = errorMsg;
        } finally {
            await this.amqpConnection.publish(
                'rocket.marketplace.results',
                'result.shopee',
                result
            );
        }
    }

    /**
     * Fetches the shop's enabled logistics channels from Shopee.
     * Falls back to a single standard channel (91003) if the API call fails.
     */
    private async getEnabledLogistics(token: any, shopId: number | string): Promise<Array<{ logistic_id: number; enabled: boolean; is_free: boolean }>> {
        const path = '/logistics/get_channel_list';
        const timestamp = Math.floor(Date.now() / 1000);
        const params = buildSignedParams(path, timestamp, token.accessToken, shopId);

        try {
            const response = await axios.get(`${this.baseUrl}${path}`, {
                headers: buildHeaders(),
                params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) },
                timeout: 8000,
            });

            const channels: any[] = response.data?.response?.logistics_channel_list ?? [];
            this.logger.log(
                `[Shopee] get_channel_list raw for shop ${shopId}: ` +
                JSON.stringify(channels.map(ch => ({
                    id: ch.logistics_channel_id,
                    name: ch.logistics_channel_name,
                    enabled: ch.enabled,
                    fee_type: ch.fee_type,
                    sizes: ch.size_list?.map((s: any) => s.size_id),
                })))
            );

            const enabled = channels
                .filter((ch) => ch.enabled === 'ENABLED')
                .map((ch) => ({ logistic_id: ch.logistics_channel_id, enabled: true, is_free: false }));

            if (enabled.length > 0) return enabled;
            this.logger.warn(`[Shopee] No enabled logistics channels found for shop ${shopId} — using fallback.`);
        } catch (e) {
            this.logger.warn(`[Shopee] Could not fetch logistics channels (shop=${shopId}): ${e.message} — using fallback.`);
        }

        return [{ logistic_id: 91003, enabled: true, is_free: false }];
    }

    private async updateStock(itemId: string, stock: number, token: any) {
        const path = '/product/update_stock';
        const timestamp = Math.floor(Date.now() / 1000);
        const shopId = token.additionalData?.shopId || token.shopId;

        const body = this.payloadBuilder.buildShopeeStockBody(itemId, stock);
        const params = buildSignedParams(path, timestamp, token.accessToken, shopId);
        await axios.post(`${this.baseUrl}${path}`, body, {
            headers: buildHeaders(),
            params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
        });
    }

    private async updatePrice(itemId: string, price: number, token: any) {
        const path = '/product/update_price';
        const timestamp = Math.floor(Date.now() / 1000);
        const shopId = token.additionalData?.shopId || token.shopId;

        const body = this.payloadBuilder.buildShopeePriceBody(itemId, price);
        const params = buildSignedParams(path, timestamp, token.accessToken, shopId);
        await axios.post(`${this.baseUrl}${path}`, body, {
            headers: buildHeaders(),
            params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
        });
    }

    private async prepareImages(images: string[], token: any): Promise<string[]> {
        const result: string[] = [];
        const uniqueImages = [...new Set(images || [])].slice(0, 9);

        for (const img of uniqueImages) {
            try {
                if (!img) continue;
                const uploadedId = await this.uploadImage(img, token);
                if (uploadedId) {
                    result.push(uploadedId);
                }
            } catch (e) {
                this.logger.warn(`Failed to upload image ${img}: ${e.message}`);
            }
        }
        return result;
    }

    private async uploadImage(imageUrl: string, token: any): Promise<string> {
        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/media_space/upload_image';
        const shopId = token.additionalData?.shopId || token.shopId || token.shop_id;
        const params = buildSignedParams(path, timestamp, token.accessToken, shopId);

        try {
            const response = await axios.post(`${this.baseUrl}${path}`, { image_url: imageUrl }, {
                headers: buildHeaders(),
                params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) },
                timeout: 10000
            });

            if (response.data?.response?.image_info?.image_id) {
                return response.data.response.image_info.image_id;
            }
        } catch (e) {
            // Fallback
        }

        try {
            const FormData = require('form-data');
            const fileResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
            const buffer = Buffer.from(fileResp.data);
            const fileNameGuess = (imageUrl.split('/').pop() || `image_${Date.now()}`).split('?')[0];
            const ct = /\.png$/i.test(fileNameGuess) ? 'image/png' : 'image/jpeg';

            const form = new FormData();
            form.append('image', buffer, { filename: fileNameGuess, contentType: ct, knownLength: buffer.length });

            const headers = { ...buildHeaders(), ...form.getHeaders() };

            const response = await axios.post(`${this.baseUrl}${path}`, form, {
                headers,
                params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
            });

            return response.data?.response?.image_info?.image_id;
        } catch (error) {
            const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`Upload Failed: ${msg}`);
        }
    }
}
