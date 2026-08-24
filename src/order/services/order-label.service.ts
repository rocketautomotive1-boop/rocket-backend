import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import * as AdmZip from 'adm-zip';
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

        // accountId identifica a loja dona do pedido — token deve ser resolvido para
        // essa conta específica, não a default do marketplace (multi-conta = 403).
        const activeToken = await this.auth.ensureValidToken(
            String(marketplace._id),
            order.accountId ? { accountId: String(order.accountId) } : undefined,
        );
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
        // shipping.id não é persistido no schema local — é resolvido ao vivo no
        // mesmo pedido usado pelo MercadoLivreOrderAdapter (GET /orders/{externalId}).
        const shipmentId = await this.resolveMlShipmentId(order.externalId, token.accessToken);

        if (!shipmentId) {
            throw new NotFoundException(
                `Shipment ID not found for order ${order.externalId}. ` +
                `Order may not have a shipment assigned yet.`
            );
        }

        this.logger.log(`[ML Label] Fetching ZPL for shipment ${shipmentId}`);

        try {
            // Endpoint correto é /shipment_labels (plural, query shipment_ids) — não
            // existe /shipments/{id}/labels. response_type=zpl2 devolve um ZIP contendo
            // "Etiqueta de envio.txt" com o ZPL — não é texto puro.
            const zipBuffer = await this.fetchMlLabel(shipmentId, token.accessToken, 'zpl2');
            const content = this.extractZplFromZip(zipBuffer);
            this.logger.log(`[ML Label] ZPL fetched for shipment ${shipmentId} (${content.length} chars)`);
            return { format: 'zpl', content, marketplace: 'mercadolivre' };
        } catch (zplError: any) {
            this.logger.warn(`[ML Label] ZPL failed, falling back to PDF: ${zplError.message}`);

            try {
                const pdfBuffer = await this.fetchMlLabel(shipmentId, token.accessToken, 'pdf');
                const pdfUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
                return { format: 'pdf', url: pdfUrl, marketplace: 'mercadolivre' };
            } catch (pdfError: any) {
                throw new Error(
                    `Failed to fetch label for ML shipment ${shipmentId}: ${pdfError.message}`
                );
            }
        }
    }

    private extractZplFromZip(zipBuffer: Buffer): string {
        const zip = new AdmZip(zipBuffer);
        const entry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.txt'));
        if (!entry) throw new Error('ZPL entry not found inside label ZIP');
        return zip.readAsText(entry);
    }

    private async resolveMlShipmentId(externalOrderId: string, accessToken: string): Promise<number | undefined> {
        const response = await axios.get(
            `https://api.mercadolibre.com/orders/${externalOrderId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        return response.data?.shipping?.id;
    }

    /**
     * response_type 'zpl2' devolve um ZIP (content-type application/zip) com o ZPL
     * dentro; 'pdf' devolve bytes de PDF puro. Em ambos, corpo de sucesso é binário —
     * só erro é JSON ({failed_shipments:[{message, cause:'NOT_PRINTABLE_STATUS', ...}]}).
     */
    private async fetchMlLabel(
        shipmentId: number,
        accessToken: string,
        responseType: 'zpl2' | 'pdf',
    ): Promise<Buffer> {
        try {
            const response = await axios.get(
                'https://api.mercadolibre.com/shipment_labels',
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { shipment_ids: shipmentId, response_type: responseType },
                    responseType: 'arraybuffer',
                },
            );
            return Buffer.from(response.data);
        } catch (error: any) {
            const raw = error.response?.data;
            const detail = raw
                ? this.parseMlLabelError(raw)
                : error.message;
            throw new Error(detail);
        }
    }

    private parseMlLabelError(raw: any): string {
        try {
            const parsed = Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf-8')) : raw;
            const failure = parsed?.failed_shipments?.[0];
            return failure?.message || parsed?.message || JSON.stringify(parsed);
        } catch {
            return Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw);
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
