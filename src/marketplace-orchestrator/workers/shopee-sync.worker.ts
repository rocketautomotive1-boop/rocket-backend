import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import axios from 'axios';
import { MarketplaceSyncPayload } from '../dto/marketplace-sync.dto';
import { MarketplaceSyncResult } from '../dto/marketplace-sync-result.dto';
import { getShopeeBaseUrl, buildSignedParams, buildHeaders } from '../../marketplace/adapters/shopee/shopee-utils';
import { MarketplaceResilienceService } from '../services/marketplace-resilience.service';

@Injectable()
export class ShopeeSyncWorker {
    private readonly logger = new Logger(ShopeeSyncWorker.name);
    private readonly baseUrl = getShopeeBaseUrl();

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly resilienceService: MarketplaceResilienceService,
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
            await this.resilienceService.execute(msg.marketplaceId, async (token) => {
                const shopId = token.additionalData?.shopId || token.shopId;
                if (!shopId) throw new Error('ShopId not found in token');

                // 1. Prepare Images
                let imageIds: string[] = [];
                if (msg.payload.images && msg.payload.images.length > 0) {
                    imageIds = await this.prepareImages(msg.payload.images, token);
                }

                const commonPayload = {
                    item_name: msg.payload.title,
                    description: msg.payload.description,
                    item_sku: msg.payload.sku,
                    original_price: msg.payload.price,
                    normal_stock: msg.payload.stock,
                    seller_stock: [{ stock: msg.payload.stock }],
                    weight: (Number(msg.payload.dimensions?.weight || 500) / 1000),

                    dimension: {
                        package_length: Number(msg.payload.dimensions?.length || 20),
                        package_width: Number(msg.payload.dimensions?.width || 20),
                        package_height: Number(msg.payload.dimensions?.height || 10),
                    },
                    brand: { brand_id: 0, original_brand_name: msg.payload.brand || 'NoBrand' },
                    image: imageIds.length > 0 ? { image_id_list: imageIds } : undefined,
                };

                const timestamp = Math.floor(Date.now() / 1000);

                if (msg.action === 'CREATE') {
                    const path = '/product/add_item';
                    const categoryId = this.extractCategoryId(msg.payload.attributes);

                    const body = {
                        ...commonPayload,
                        category_id: Number(categoryId),
                        logistic_info: [{ logistic_id: 91003, enabled: true, is_free: false }], // Default Logística
                        tax_info: {
                            ncm: '87089990',
                            same_state_cfop: '5102',
                            diff_state_cfop: '6108',
                            csosn: '',
                            origin: '0',
                            cest: '0199900',
                            measure_unit: 'UN'
                        }
                    };

                    const params = buildSignedParams(path, timestamp, token.accessToken, shopId);

                    const response = await axios.post(`${this.baseUrl}${path}`, body, {
                        headers: buildHeaders(),
                        params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
                    });

                    if (response.data.error) {
                        throw new Error(`Shopee API Error: ${response.data.message || response.data.error}`);
                    }

                    if (!response.data.response || !response.data.response.item_id) {
                        throw new Error(`Invalid Shopee Response (No item_id): ${JSON.stringify(response.data)}`);
                    }

                    result.externalId = String(response.data.response.item_id);
                    this.logger.log(`[Shopee] Created item ${result.externalId}`);

                } else if (msg.action === 'UPDATE') {
                    if (!msg.externalId) throw new Error('Update requires externalId');

                    const path = '/product/update_item';
                    const body = {
                        item_id: Number(msg.externalId),
                        ...commonPayload
                    };

                    // 1. Update Basic Info
                    const params = buildSignedParams(path, timestamp, token.accessToken, shopId);
                    const response = await axios.post(`${this.baseUrl}${path}`, body, {
                        headers: buildHeaders(),
                        params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) }
                    });

                    if (response.data.error) {
                        throw new Error(`Shopee API Update Error: ${response.data.message || response.data.error}`);
                    }

                    // 2. Update Stock
                    if (msg.payload.stock !== undefined) {
                        await this.updateStock(msg.externalId, msg.payload.stock, token);
                    }

                    // 3. Update Price
                    if (msg.payload.price !== undefined) {
                        await this.updatePrice(msg.externalId, msg.payload.price, token);
                    }

                    result.externalId = msg.externalId;
                    this.logger.log(`[Shopee] Updated item ${result.externalId}`);
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

    private extractCategoryId(attrs: any[]): string {
        const cat = attrs.find(a => a.id === 'category_id');
        const val = cat ? cat.value : null;

        if (val && /^\d+$/.test(String(val)) && String(val) !== '0') {
            return String(val);
        }

        this.logger.warn(`[Shopee] Invalid or missing category_id (${val}). Using default 102284.`);
        return '102284'; // Default "Outros"
    }

    private async updateStock(itemId: string, stock: number, token: any) {
        const path = '/product/update_stock';
        const timestamp = Math.floor(Date.now() / 1000);
        const shopId = token.additionalData?.shopId || token.shopId;

        const body = {
            item_id: Number(itemId),
            stock_list: [{ model_id: 0, seller_stock: [{ stock }] }]
        };
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

        const body = {
            item_id: Number(itemId),
            price_list: [{ original_price: price }]
        };
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

        // 1. Try URL Upload (Lightweight)
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

        // 2. Buffer Upload (Robust)
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
