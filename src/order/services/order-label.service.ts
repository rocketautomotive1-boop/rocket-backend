import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { OrderDocument, OrderModel } from '../schemas/order.schema';
import { MarketplaceConfigCacheService } from '../../marketplace/services/marketplace-config-cache.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { buildHeaders, getShopeeBaseUrl } from '../../marketplace/adapters/shopee/shopee-utils';
import { ShopeeSignerService } from '../../marketplace/adapters/shopee/shopee-signer.service';

export interface LabelResult {
    format: 'zpl' | 'pdf' | 'url';
    content?: string;   // ZPL text content
    url?: string;       // PDF download URL
    marketplace: string;
}

@Injectable()
export class OrderLabelService {
    private readonly logger = new Logger(OrderLabelService.name);

    constructor(
        @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
        private readonly configCache: MarketplaceConfigCacheService,
        private readonly auth: MarketplaceAuthService,
        private readonly signer: ShopeeSignerService,
    ) {}

    async getLabel(orderId: string): Promise<LabelResult> {
        const order = await this.orderModel.findById(orderId).lean().exec();
        if (!order) throw new NotFoundException(`Order ${orderId} not found`);

        const marketplace = await this.configCache.getById(String(order.marketplaceId));
        if (!marketplace) throw new NotFoundException(`Marketplace not found for order ${orderId}`);

        // Via única de token (resolve via accounts[], renova se preciso).
        const activeToken = await this.auth.ensureValidToken(String(marketplace._id));
        if (!activeToken?.accessToken) {
            throw new NotFoundException(`No active token for marketplace ${marketplace.name}`);
        }

        const tag = (marketplace.tag || '').toLowerCase();

        switch (tag) {
            case 'mercadolivre':
                return this.getMercadoLivreLabel(order as any, marketplace as any, activeToken);
            case 'shopee':
                return this.getShopeeLabel(order as any, marketplace as any, activeToken);
            default:
                throw new NotFoundException(
                    `Shipping label not supported for marketplace "${marketplace.name}". ` +
                    `Supported: Mercado Livre, Shopee.`
                );
        }
    }

    private async getMercadoLivreLabel(order: any, marketplace: any, token: any): Promise<LabelResult> {
        // Try to get shipment ID from order data
        const shipmentId = order.marketplaceData?.shipment?.id
            || order.marketplaceData?.shipments?.[0]?.id
            || order.externalShipmentId;

        if (!shipmentId) {
            throw new NotFoundException(
                `Shipment ID not found for order ${order.externalId}. ` +
                `Order may not have a shipment assigned yet.`
            );
        }

        this.logger.log(`[ML Label] Fetching ZPL for shipment ${shipmentId}`);

        try {
            // Try ZPL first (for thermal printers)
            const response = await axios.get(
                `https://api.mercadolibre.com/shipments/${shipmentId}/labels`,
                {
                    headers: { Authorization: `Bearer ${token.accessToken}` },
                    params: { type: 'zpl2', response_type: 'label' },
                    responseType: 'text',
                }
            );

            const content = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data);

            this.logger.log(`[ML Label] ZPL fetched for shipment ${shipmentId} (${content.length} chars)`);

            return { format: 'zpl', content, marketplace: 'mercadolivre' };
        } catch (zplError: any) {
            this.logger.warn(`[ML Label] ZPL failed, falling back to PDF: ${zplError.message}`);

            // Fallback: PDF
            try {
                const response = await axios.get(
                    `https://api.mercadolibre.com/shipments/${shipmentId}/labels`,
                    {
                        headers: { Authorization: `Bearer ${token.accessToken}` },
                        params: { type: 'pdf' },
                    }
                );

                const pdfUrl = response.data?.content_base64
                    ? `data:application/pdf;base64,${response.data.content_base64}`
                    : response.data?.label_url || response.request?.res?.responseUrl;

                return { format: 'pdf', url: pdfUrl, marketplace: 'mercadolivre' };
            } catch (pdfError: any) {
                throw new Error(
                    `Failed to fetch label for ML shipment ${shipmentId}: ${pdfError.message}`
                );
            }
        }
    }

    private async getShopeeLabel(order: any, marketplace: any, token: any): Promise<LabelResult> {
        const shopId = token.additionalData?.shopId || token.shopId;
        if (!shopId) throw new Error('ShopId not found in Shopee token');

        const orderSn = order.externalId;
        if (!orderSn) throw new NotFoundException(`External order ID not found`);

        const baseUrl = getShopeeBaseUrl();
        const path = '/logistics/download_shipping_doc';
        const timestamp = Math.floor(Date.now() / 1000);

        const body = {
            order_list: [{ order_sn: orderSn }],
            shipping_document_type: 'THERMAL_AIR_WAYBILL',
        };

        const params = await this.signer.buildSignedParams(path, timestamp, token.accessToken, Number(shopId));

        this.logger.log(`[Shopee Label] Requesting THERMAL_AIR_WAYBILL for order ${orderSn}`);

        try {
            const response = await axios.post(`${baseUrl}${path}`, body, {
                headers: buildHeaders(),
                params: { ...params, access_token: token.accessToken, shop_id: Number(shopId) },
                responseType: 'arraybuffer',
            });

            if (response.data?.error) {
                throw new Error(response.data.message || response.data.error);
            }

            // Shopee returns a PDF buffer directly
            const base64 = Buffer.from(response.data).toString('base64');
            const dataUrl = `data:application/pdf;base64,${base64}`;

            this.logger.log(`[Shopee Label] PDF fetched for order ${orderSn}`);
            return { format: 'pdf', url: dataUrl, marketplace: 'shopee' };
        } catch (error: any) {
            // If arraybuffer fails, try JSON response (some endpoints return a URL)
            const detail = error.response?.data
                ? Buffer.from(error.response.data).toString('utf-8')
                : error.message;
            throw new Error(`Shopee label error for order ${orderSn}: ${detail}`);
        }
    }
}
